import type { Hero, Item, ItemCategory, StatKey } from '../types'
import { INVESTMENT, investmentBonus } from '../data/investmentBonuses'

/**
 * Resulting stat values for a hero at a level with a given build.
 *
 * The stacking order was not guessed — it was fitted against 119,630 real
 * player records, whose end-of-match sheets report observed max_health,
 * weapon_power and tech_power. Of the candidate orderings, only one lands
 * unbiased:
 *
 *   maxHealth = (base + perLevel x (L-1) + itemHealth) x (1 + vitality%)
 *
 * Median error -0.7 HP against an observed mean near 3,000. Applying the
 * investment percentage to base alone instead is off by -739 median, so
 * the percentage demonstrably covers item health too.
 *
 *   weaponDamage% = itemBulletDamage% + perLevel x (L-1) + weapon investment%
 *   spiritPower   = itemSpiritPower  + perLevel x (L-1) + spirit investment
 *
 * Level matters more than it looks: at level 33 it is roughly 1,500 health
 * for a typical hero, about half the final pool, and dropping it from the
 * spirit formula doubles the error (MAE 21 -> 51).
 *
 * Both damage figures still run slightly low against observation (median
 * -8 weapon, -11 spirit). That residual is the deliberately simplified item
 * mapping: conditional, stacking and on-proc properties carry real power
 * that never enters the passive stat block. Treat these as a floor.
 */

export const MIN_HERO_LEVEL = 1
export const MAX_HERO_LEVEL = 36

export interface StatTotal {
  key: StatKey
  /** From the hero's own base sheet (0 where the stat starts at nothing). */
  base: number
  /** Accumulated from levels, i.e. perLevel x (level - 1). */
  fromLevel: number
  fromItems: number
  fromInvestment: number
  /** Multiplier applied after summing, currently only vitality on health. */
  multiplier: number
  total: number
}

export interface BuildStats {
  level: number
  categorySpend: Record<ItemCategory, number>
  /** Cumulative investment bonus per category at the current spend. */
  investment: Record<ItemCategory, number>
  totals: Partial<Record<StatKey, StatTotal>>
}

function sumItemStat(items: Item[], key: StatKey): number {
  return items.reduce((sum, item) => sum + (item.stats[key] ?? 0), 0)
}

export function computeBuildStats(
  hero: Hero,
  items: Item[],
  level: number,
): BuildStats {
  const upgrades = Math.max(0, level - 1)

  const categorySpend: Record<ItemCategory, number> = {
    weapon: 0,
    vitality: 0,
    spirit: 0,
  }
  for (const item of items) categorySpend[item.category] += item.cost

  const investment: Record<ItemCategory, number> = {
    weapon: investmentBonus('weapon', categorySpend.weapon),
    vitality: investmentBonus('vitality', categorySpend.vitality),
    spirit: investmentBonus('spirit', categorySpend.spirit),
  }

  const totals: Partial<Record<StatKey, StatTotal>> = {}
  const add = (key: StatKey, parts: Omit<StatTotal, 'key' | 'total'>) => {
    const summed = parts.base + parts.fromLevel + parts.fromItems + parts.fromInvestment
    totals[key] = { key, ...parts, total: summed * parts.multiplier }
  }

  // Vitality investment is a percentage of everything, items included.
  add('maxHealth', {
    base: hero.baseStats.maxHealth,
    fromLevel: hero.perLevel.maxHealth * upgrades,
    fromItems: sumItemStat(items, 'maxHealth'),
    fromInvestment: 0,
    multiplier: 1 + investment.vitality / 100,
  })

  add('bulletDamage', {
    base: 0,
    fromLevel: hero.perLevel.bulletDamage * upgrades,
    fromItems: sumItemStat(items, 'bulletDamage'),
    fromInvestment: investment.weapon,
    multiplier: 1,
  })

  add('spiritPower', {
    base: 0,
    fromLevel: hero.perLevel.spiritPower * upgrades,
    fromItems: sumItemStat(items, 'spiritPower'),
    fromInvestment: investment.spirit,
    multiplier: 1,
  })

  // Everything else is a plain sum over items, on top of a base where the
  // hero sheet provides one. No investment tier touches these.
  const simple: [StatKey, number][] = [
    ['moveSpeed', hero.baseStats.moveSpeed],
    ['healthRegen', hero.baseStats.healthRegen],
    ['bulletResist', 0],
    ['spiritResist', 0],
    ['fireRate', 0],
    ['cooldownReduction', 0],
    ['lifesteal', 0],
  ]
  for (const [key, base] of simple) {
    add(key, {
      base,
      fromLevel: 0,
      fromItems: sumItemStat(items, key),
      fromInvestment: 0,
      multiplier: 1,
    })
  }

  return { level, categorySpend, investment, totals }
}

/** Investment categories that feed a given stat, for labelling in the UI. */
export function investmentCategoryFor(key: StatKey): ItemCategory | null {
  for (const category of Object.keys(INVESTMENT) as ItemCategory[]) {
    if (INVESTMENT[category].statKey === key) return category
  }
  return null
}
