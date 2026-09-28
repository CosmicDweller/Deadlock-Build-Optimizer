import type { HeroArchetype, Item, ItemCategory } from '../types'
import type { ScoringModel } from './optimizer'
import { metaScore } from './heroMeta'
import rawLearnedValues from '../data/learnedValues.json'

/**
 * Item values learned from real match data by the Python pipeline
 * (ml/train.py, exported by ml/export_values.py). Each coefficient is in
 * standard deviations of its objective metric, which is what makes mixing
 * objectives with different units meaningful.
 *
 * These values capture what the stat-based scoring can't: an item's active
 * and conditional effects show up in the end-of-match numbers even though
 * they never appear in the passive stat block we parse out of the API.
 */
export interface LearnedTarget {
  key: string
  label: string
  description: string
  /** Cross-validated R^2 — how much of the metric items actually explain. */
  r2: number
}

interface LearnedValuesFile {
  generated: string
  nRows: number
  nMatches: number
  targets: LearnedTarget[]
  itemCounts: Record<string, number>
  heroGames: Record<string, number>
  /** Inner keys are target indices into `targets`, not target names. */
  items: Record<string, Record<string, number>>
  heroAdjustments: Record<string, Record<string, Record<string, number>>>
}

export const LEARNED = rawLearnedValues as LearnedValuesFile
export const LEARNED_TARGETS = LEARNED.targets

/** target key -> its index in the exported tables. */
const TARGET_INDEX: Record<string, string> = Object.fromEntries(
  LEARNED_TARGETS.map((target, i) => [target.key, String(i)]),
)

export type ObjectiveWeights = Record<string, number>

// Presets lean on the split damage targets rather than blended Hero DPS:
// separating ability from gun damage roughly doubled how much of each the
// items actually explain, so they carry far more signal.
export const DEFAULT_OBJECTIVES_BY_ARCHETYPE: Record<HeroArchetype, ObjectiveWeights> = {
  bullet: { bullet_dps: 1, weapon_power: 0.6, max_health: 0.2 },
  spirit: { ability_dps: 1, spirit_power: 0.6, ability_kills: 0.3, max_health: 0.2 },
  vitality: { max_health: 1, mitigation: 0.8, healing: 0.4, bullet_dps: 0.3 },
  hybrid: {
    ability_dps: 0.6,
    bullet_dps: 0.6,
    weapon_power: 0.3,
    spirit_power: 0.3,
    max_health: 0.3,
  },
}

export function learnedItemValue(
  item: Item,
  weights: ObjectiveWeights,
  heroId: string | null,
  metaWeight = 0,
): number {
  const base = LEARNED.items[item.id]
  const adjustments = heroId ? LEARNED.heroAdjustments[heroId]?.[item.id] : undefined

  let total = 0
  if (base) {
    for (const target in weights) {
      const weight = weights[target]
      if (!weight) continue
      const index = TARGET_INDEX[target]
      if (index === undefined) continue
      const coefficient = (base[index] ?? 0) + (adjustments?.[index] ?? 0)
      total += coefficient * weight
    }
  }
  // Pick-rate lift is z-scored on export, so it lands on the same scale as
  // the performance coefficients and this is a like-for-like blend.
  if (metaWeight) total += metaScore(heroId, item.id) * metaWeight
  return total
}

/** Per-objective breakdown of one item's value, for display. */
export function learnedItemBreakdown(
  item: Item,
  weights: ObjectiveWeights,
  heroId: string | null,
  metaWeight = 0,
): { target: string; label: string; value: number }[] {
  const base = LEARNED.items[item.id]
  const adjustments = heroId ? LEARNED.heroAdjustments[heroId]?.[item.id] : undefined

  const entries = LEARNED_TARGETS.map((target, i) => {
    const weight = weights[target.key]
    if (!weight || !base) return null
    const index = String(i)
    return {
      target: target.key,
      label: target.label,
      value: ((base[index] ?? 0) + (adjustments?.[index] ?? 0)) * weight,
    }
  }).filter((entry): entry is { target: string; label: string; value: number } =>
    entry !== null && entry.value !== 0,
  )

  if (metaWeight) {
    const value = metaScore(heroId, item.id) * metaWeight
    if (value !== 0) entries.push({ target: 'meta', label: 'Meta', value })
  }
  return entries
}

export function createLearnedScoring(
  weights: ObjectiveWeights,
  heroId: string | null,
  metaWeight = 0,
): ScoringModel {
  return {
    scoreItem: (item) => learnedItemValue(item, weights, heroId, metaWeight),
    // The learned coefficients already include whatever the investment
    // bonus contributed — players who crossed a threshold had the bonus
    // active when their end-of-match stats were recorded. Adding our own
    // estimate on top would double-count it.
    categoryBonus: (_category: ItemCategory) => 0,
    appliesInvestmentBonus: false,
  }
}
