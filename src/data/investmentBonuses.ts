import type { ItemCategory, StatKey } from '../types'

// Deadlock grants a passive bonus in each category (Weapon/Vitality/Spirit)
// once you've spent enough souls on items in that category, regardless of
// which specific items you bought. Exact live values drift with patches —
// these are best-effort placeholders, edit freely to match current balance.
export const INVESTMENT_THRESHOLD = 4800

export const INVESTMENT_BONUSES: Record<
  ItemCategory,
  { label: string; stats: Partial<Record<StatKey, number>> }
> = {
  weapon: {
    label: 'Weapon Investment Bonus',
    stats: { bulletDamage: 6, fireRate: 6 },
  },
  vitality: {
    label: 'Vitality Investment Bonus',
    stats: { maxHealth: 75, bulletResist: 6 },
  },
  spirit: {
    label: 'Spirit Investment Bonus',
    stats: { spiritPower: 8, cooldownReduction: 6 },
  },
}
