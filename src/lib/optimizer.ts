import type { BuildResult, Item, ItemCategory, StatKey } from '../types'
import { INVESTMENT, investmentBonus } from '../data/investmentBonuses'

// Real builds cap at 12 items TOTAL, shared across categories — match data
// shows single-category counts as high as 9-10, so there's no meaningful
// per-category slot cap to enforce.
export const MAX_SLOTS = 12

// Every real item cost (800/1600/3200/6400) is a multiple of 800; the
// 9999-soul tier 5s round UP to 10400, so a suggested build is never one the
// budget can't actually cover. Bucketing this coarsely is what keeps the
// slots x cost merge below cheap enough to rerun on every slider drag.
const BUCKET_SIZE = 800
const NEG = -Infinity

/**
 * Raw stat magnitudes aren't comparable (+250 max health vs +14% bullet
 * damage vs +6 spirit power), so a weight of 1 on each would silently favor
 * whichever stat happens to have the biggest numbers. We normalize every
 * stat by the largest single-item (or investment bonus) bump of that stat
 * in the pool, so a weight represents relative priority rather than raw
 * point value.
 */
function computeStatScales(items: Item[]): Partial<Record<StatKey, number>> {
  const scales: Partial<Record<StatKey, number>> = {}
  const consider = (stats: Partial<Record<StatKey, number>>) => {
    for (const key in stats) {
      const statKey = key as StatKey
      const value = Math.abs(stats[statKey] ?? 0)
      if (value > (scales[statKey] ?? 0)) scales[statKey] = value
    }
  }
  for (const item of items) consider(item.stats)
  // The top investment tier is a large bump in its own stat, so it belongs
  // in the normalization range alongside the items.
  for (const category of Object.keys(INVESTMENT) as ItemCategory[]) {
    const spec = INVESTMENT[category]
    const top = spec.tiers[spec.tiers.length - 1]
    consider({ [spec.statKey]: top.cumulative })
  }
  return scales
}

function weightedStatValue(
  stats: Partial<Record<StatKey, number>>,
  weights: Partial<Record<StatKey, number>>,
  scales: Partial<Record<StatKey, number>>,
): number {
  let total = 0
  for (const key in stats) {
    const statKey = key as StatKey
    const value = stats[statKey] ?? 0
    const weight = weights[statKey] ?? 0
    const scale = scales[statKey] || 1
    total += (value / scale) * weight
  }
  return total
}

/**
 * How the optimizer values items. Two implementations exist: scoring off
 * the stat sliders (createStatScoring) and scoring off coefficients learned
 * from match data (createLearnedScoring).
 */
export interface ScoringModel {
  scoreItem(item: Item): number
  /**
   * Score for a category's investment bonus at a given spend. The bonus is
   * a step function over 11 thresholds, so it has to be evaluated per spend
   * level rather than as one cutoff.
   */
  categoryBonusAt(category: ItemCategory, souls: number): number
  /** Whether the investment bonus's stats count toward the build's totals. */
  appliesInvestmentBonus: boolean
}

export function createStatScoring(
  allItems: Item[],
  weights: Partial<Record<StatKey, number>>,
  /**
   * Health the vitality percentage will apply to (hero base plus level).
   * Vitality investment is a percentage, so it has to be converted into
   * points against some reference to compare with flat item health. Item
   * health is excluded here because the search can't know it yet, which
   * makes this a slight underestimate of that category's value.
   */
  referenceHealth = 0,
): ScoringModel {
  const scales = computeStatScales(allItems)
  return {
    scoreItem: (item) => weightedStatValue(item.stats, weights, scales),
    categoryBonusAt: (category, souls) => {
      const spec = INVESTMENT[category]
      const bonus = investmentBonus(category, souls)
      if (!bonus) return 0
      const value =
        spec.unit === 'percent' && spec.statKey === 'maxHealth'
          ? (bonus / 100) * referenceHealth
          : bonus
      return weightedStatValue({ [spec.statKey]: value }, weights, scales)
    },
    appliesInvestmentBonus: true,
  }
}

interface CategorySolution {
  /** table[slots][bucket] = best score using exactly that many slots/spend. */
  table: number[][]
  reconstruct: (slots: number, bucket: number) => Item[]
}

/**
 * 0/1 knapsack over one category. dp[i][k][c] = best score using exactly k
 * items from the first i items at an exact spend of bucket c (-Infinity for
 * unreachable combinations). Tracking exact spend rather than "at most" is
 * what lets us tell whether a selection crosses this category's investment
 * threshold, so the bonus can steer the search instead of just being
 * reported after the fact.
 */
function solveCategory(
  items: Item[],
  maxBucket: number,
  maxSlots: number,
  scoring: ScoringModel,
  category: ItemCategory,
): CategorySolution {
  const n = items.length
  const itemCost = items.map((it) => Math.ceil(it.cost / BUCKET_SIZE))
  const itemScore = items.map((it) => scoring.scoreItem(it))

  const dp: number[][][] = new Array(n + 1)
  dp[0] = Array.from({ length: maxSlots + 1 }, () => new Array(maxBucket + 1).fill(NEG))
  dp[0][0][0] = 0

  for (let i = 0; i < n; i++) {
    const prev = dp[i]
    const cur = prev.map((row) => row.slice())
    const cost = itemCost[i]
    const sc = itemScore[i]
    for (let k = 1; k <= maxSlots; k++) {
      for (let c = cost; c <= maxBucket; c++) {
        const candidate = prev[k - 1][c - cost]
        if (candidate !== NEG) {
          const val = candidate + sc
          if (val > cur[k][c]) cur[k][c] = val
        }
      }
    }
    dp[i + 1] = cur
  }

  // Fold the investment bonus in at the threshold. Reconstruction walks the
  // raw dp, so adding it here only affects which cell wins, not the path.
  const table: number[][] = dp[n].map((row, k) =>
    row.map((value, c) => {
      if (value === NEG) return NEG
      if (k === 0) return value
      return value + scoring.categoryBonusAt(category, c * BUCKET_SIZE)
    }),
  )

  function reconstruct(slots: number, bucket: number): Item[] {
    let kk = slots
    let cc = bucket
    const chosen: Item[] = []
    for (let i = n; i > 0 && kk > 0; i--) {
      if (dp[i][kk][cc] === dp[i - 1][kk][cc]) continue
      chosen.push(items[i - 1])
      cc -= itemCost[i - 1]
      kk -= 1
    }
    return chosen
  }

  return { table, reconstruct }
}

interface MergeResult {
  table: number[][]
  /** splitA[slots][bucket] = [slotsFromA, bucketFromA] for that cell. */
  splitA: [number, number][][]
}

/** Max-plus convolution of two (slots x bucket) tables. */
function mergeTables(a: number[][], b: number[][], maxSlots: number, maxBucket: number): MergeResult {
  const table: number[][] = Array.from({ length: maxSlots + 1 }, () =>
    new Array(maxBucket + 1).fill(NEG),
  )
  const splitA: [number, number][][] = Array.from({ length: maxSlots + 1 }, () =>
    new Array(maxBucket + 1).fill(null).map(() => [0, 0] as [number, number]),
  )

  for (let ka = 0; ka <= maxSlots; ka++) {
    for (let ca = 0; ca <= maxBucket; ca++) {
      const left = a[ka][ca]
      if (left === NEG) continue
      for (let kb = 0; kb + ka <= maxSlots; kb++) {
        const rowB = b[kb]
        const rowOut = table[ka + kb]
        const splitRow = splitA[ka + kb]
        for (let cb = 0; cb + ca <= maxBucket; cb++) {
          const right = rowB[cb]
          if (right === NEG) continue
          const total = left + right
          if (total > rowOut[ca + cb]) {
            rowOut[ca + cb] = total
            splitRow[ca + cb] = [ka, ca]
          }
        }
      }
    }
  }

  return { table, splitA }
}

export function optimizeBuild(
  allItems: Item[],
  scoring: ScoringModel,
  budget: number,
  maxSlots = MAX_SLOTS,
): BuildResult {
  const maxBucket = Math.max(0, Math.floor(budget / BUCKET_SIZE))

  const byCategory: Record<ItemCategory, Item[]> = {
    weapon: allItems.filter((i) => i.category === 'weapon'),
    vitality: allItems.filter((i) => i.category === 'vitality'),
    spirit: allItems.filter((i) => i.category === 'spirit'),
  }

  const solutions: Record<ItemCategory, CategorySolution> = {
    weapon: solveCategory(byCategory.weapon, maxBucket, maxSlots, scoring, 'weapon'),
    vitality: solveCategory(byCategory.vitality, maxBucket, maxSlots, scoring, 'vitality'),
    spirit: solveCategory(byCategory.spirit, maxBucket, maxSlots, scoring, 'spirit'),
  }

  const merge12 = mergeTables(solutions.weapon.table, solutions.vitality.table, maxSlots, maxBucket)
  const merge123 = mergeTables(merge12.table, solutions.spirit.table, maxSlots, maxBucket)

  // Best cell using at most the budget and at most the slot cap.
  let bestScore = 0
  let bestSlots = 0
  let bestBucket = 0
  for (let k = 0; k <= maxSlots; k++) {
    for (let c = 0; c <= maxBucket; c++) {
      const value = merge123.table[k][c]
      if (value !== NEG && value > bestScore) {
        bestScore = value
        bestSlots = k
        bestBucket = c
      }
    }
  }

  const [slots12, bucket12] = merge123.splitA[bestSlots][bestBucket]
  const spiritSlots = bestSlots - slots12
  const spiritBucket = bestBucket - bucket12
  const [weaponSlots, weaponBucket] = merge12.splitA[slots12][bucket12]
  const vitalitySlots = slots12 - weaponSlots
  const vitalityBucket = bucket12 - weaponBucket

  const chosenItems = [
    ...solutions.weapon.reconstruct(weaponSlots, weaponBucket),
    ...solutions.vitality.reconstruct(vitalitySlots, vitalityBucket),
    ...solutions.spirit.reconstruct(spiritSlots, spiritBucket),
  ]

  const totalStats: Partial<Record<StatKey, number>> = {}
  const categorySpend: Record<ItemCategory, number> = { weapon: 0, vitality: 0, spirit: 0 }
  const slotsUsed: Record<ItemCategory, number> = { weapon: 0, vitality: 0, spirit: 0 }
  let totalCost = 0
  let score = 0

  for (const item of chosenItems) {
    totalCost += item.cost
    slotsUsed[item.category] += 1
    categorySpend[item.category] += item.cost
    score += scoring.scoreItem(item)
    for (const key in item.stats) {
      const statKey = key as StatKey
      totalStats[statKey] = (totalStats[statKey] ?? 0) + (item.stats[statKey] ?? 0)
    }
  }

  // Investment bonuses are reported as their own figures rather than folded
  // into totalStats: vitality's is a percentage of total health, so it can't
  // be summed with flat item health. computeBuildStats (lib/statTotals.ts)
  // is what turns all of this into resulting values for a hero and level.
  const categoryInvestment: Record<ItemCategory, number> = {
    weapon: investmentBonus('weapon', categorySpend.weapon),
    vitality: investmentBonus('vitality', categorySpend.vitality),
    spirit: investmentBonus('spirit', categorySpend.spirit),
  }

  if (scoring.appliesInvestmentBonus) {
    for (const category of Object.keys(categoryInvestment) as ItemCategory[]) {
      score += scoring.categoryBonusAt(category, categorySpend[category])
    }
  }

  chosenItems.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return b.cost - a.cost
  })

  return {
    chosenItems,
    totalCost,
    totalStats,
    score,
    slotsUsed,
    categorySpend,
    categoryInvestment,
    investmentBonusApplied: scoring.appliesInvestmentBonus,
  }
}
