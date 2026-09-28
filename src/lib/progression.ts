import type { Item } from '../types'
import type { ScoringModel } from './optimizer'
import { optimizeBuild } from './optimizer'
import { HERO_META, phaseMetaScore } from './heroMeta'

/**
 * A build split into laning / mid / late, rather than one endgame snapshot.
 *
 * Phase boundaries and budgets come from purchase timings across 10,000
 * matches. Median cumulative item spend runs 3,200 by minute 10, 14,400 by
 * 22 and 33,600 by 36, which is also about where games end (median 36
 * minutes). The median player has bought nothing at all by minute 5.
 *
 * Continuity is a preference, not a rule. 77.7% of upgrades are bought
 * through their component, so an early item that upgrades into a late one
 * wastes nothing and is scored up. But 51.2% of players also manually sell
 * something — overwhelmingly a T1 or T2 held about 23 minutes and then
 * dropped to free a slot — so a dead-end laning item is allowed to earn its
 * place and be sold later.
 *
 * Soul budgets are shared across heroes. Farm rate barely varies by hero
 * (1.13x on net worth, 1.19x on spend at 30 minutes); what varies is the
 * item mix, by 7.2x on active items, and the per-hero scoring already
 * carries that.
 */

export interface PhaseSpec {
  key: 'laning' | 'mid' | 'late'
  label: string
  /** Minute this phase is measured at. */
  minute: number
  description: string
}

export const PHASES: PhaseSpec[] = [
  { key: 'laning', label: 'Laning', minute: 10, description: 'Through the first ten minutes' },
  { key: 'mid', label: 'Mid game', minute: 22, description: 'Objectives and rotations' },
  { key: 'late', label: 'Late game', minute: 36, description: 'Where the median game ends' },
]

export type ItemFate = 'keeps' | 'upgrades' | 'sold'

export interface PhaseItem {
  item: Item
  /** What becomes of it later: kept, upgraded into something, or sold. */
  fate: ItemFate
  /** The item it upgrades into, when fate is 'upgrades'. */
  upgradesInto?: Item
  /** True when it first appears in this phase. */
  isNew: boolean
}

export interface BuildPhase {
  spec: PhaseSpec
  items: PhaseItem[]
  /** Souls committed by the end of this phase, sunk costs included. */
  spent: number
  budget: number
}

export interface Progression {
  phases: BuildPhase[]
  /** Souls spent on items that get sold rather than carried forward. */
  wastedSouls: number
}

/** Median cumulative spend at a minute mark, interpolated between samples. */
export function soulsByMinute(minute: number): number {
  const curve = HERO_META.soulCurve
  if (!curve.length) return 0
  if (minute <= curve[0].minute) return curve[0].souls
  for (let i = 1; i < curve.length; i++) {
    if (minute <= curve[i].minute) {
      const a = curve[i - 1]
      const b = curve[i]
      const t = (minute - a.minute) / (b.minute - a.minute)
      return Math.round(a.souls + t * (b.souls - a.souls))
    }
  }
  return curve[curve.length - 1].souls
}

/**
 * Phase budgets scaled so the last phase equals the user's soul budget,
 * keeping the measured shape of the curve.
 */
function phaseBudgets(budget: number): number[] {
  const endSouls = soulsByMinute(PHASES[PHASES.length - 1].minute) || 1
  return PHASES.map((phase) =>
    Math.round((soulsByMinute(phase.minute) / endSouls) * budget),
  )
}

/**
 * Score bonus for an early item that survives into the final build, either
 * as itself or by upgrading. Sized to break ties toward continuity without
 * overriding a clearly stronger dead-end pick.
 */
const CONTINUITY_BONUS = 0.15

function componentIds(items: Item[]): Map<string, Item> {
  // component id -> the final-build item it upgrades into
  const byId = new Map(items.map((i) => [i.id, i]))
  const out = new Map<string, Item>()
  const walk = (target: Item, id: string, depth: number) => {
    if (depth > 4) return
    const item = byId.get(id)
    for (const component of item?.components ?? []) {
      out.set(component, target)
      walk(target, component, depth + 1)
    }
  }
  for (const item of items) {
    for (const component of item.components) {
      out.set(component, item)
      walk(item, component, 1)
    }
  }
  return out
}

export function buildProgression(
  allItems: Item[],
  scoring: ScoringModel,
  budget: number,
  heroId: string | null,
  /** Weight on "what this hero holds at this minute", matching the meta slider. */
  metaWeight: number,
  maxSlots?: number,
): Progression {
  const budgets = phaseBudgets(budget)
  const final = optimizeBuild(allItems, scoring, budget, maxSlots)
  const finalIds = new Set(final.chosenItems.map((i) => i.id))
  const upgradeTarget = componentIds(final.chosenItems)

  // Earlier phases swap the endgame meta term for "what this hero is
  // actually holding at this minute", which is the only signal here that
  // knows about lane value, and add a nudge toward anything that carries
  // forward — the item itself, or a component that upgrades into one.
  const phaseScoring = (minute: number): ScoringModel => ({
    ...scoring,
    scoreItem: (item) => {
      const base = scoring.scoreItem(item)
      const phaseMeta = phaseMetaScore(minute, heroId, item.id) * metaWeight
      const carries = finalIds.has(item.id) || upgradeTarget.has(item.id)
      return base + phaseMeta + (carries ? CONTINUITY_BONUS : 0)
    },
  })

  const phaseSets: Item[][] = PHASES.map((phase, index) => {
    if (index === PHASES.length - 1) return final.chosenItems
    return optimizeBuild(allItems, phaseScoring(phase.minute), budgets[index], maxSlots)
      .chosenItems
  })

  let wastedSouls = 0
  const phases: BuildPhase[] = phaseSets.map((items, index) => {
    const previous = index > 0 ? new Set(phaseSets[index - 1].map((i) => i.id)) : new Set<string>()
    const next = index < phaseSets.length - 1 ? phaseSets[index + 1] : null
    const nextIds = next ? new Set(next.map((i) => i.id)) : null
    const nextUpgrades = next ? componentIds(next) : null

    const phaseItems: PhaseItem[] = items.map((item) => {
      let fate: ItemFate = 'keeps'
      let upgradesInto: Item | undefined
      if (nextIds && !nextIds.has(item.id)) {
        const target = nextUpgrades?.get(item.id)
        if (target) {
          fate = 'upgrades'
          upgradesInto = target
        } else {
          fate = 'sold'
        }
      }
      return { item, fate, upgradesInto, isNew: !previous.has(item.id) }
    })

    // An item bought and later sold is spend that buys nothing lasting;
    // upgrading isn't, since the parent's full price already covers it.
    for (const entry of phaseItems) {
      if (entry.fate === 'sold' && entry.isNew) wastedSouls += entry.item.cost
    }

    const carried = phaseItems.reduce((sum, e) => sum + e.item.cost, 0)
    return {
      spec: PHASES[index],
      items: phaseItems.sort((a, b) => b.item.cost - a.item.cost),
      spent: carried,
      budget: budgets[index],
    }
  })

  return { phases, wastedSouls }
}
