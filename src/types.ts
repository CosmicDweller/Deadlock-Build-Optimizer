export type StatKey =
  | 'spiritPower'
  | 'bulletDamage'
  | 'fireRate'
  | 'bulletResist'
  | 'spiritResist'
  | 'maxHealth'
  | 'healthRegen'
  | 'moveSpeed'
  | 'cooldownReduction'
  | 'lifesteal'

export const STAT_LABELS: Record<StatKey, string> = {
  spiritPower: 'Spirit Power',
  bulletDamage: 'Bullet Damage',
  fireRate: 'Fire Rate',
  bulletResist: 'Bullet Resist',
  spiritResist: 'Spirit Resist',
  maxHealth: 'Max Health',
  healthRegen: 'Health Regen',
  moveSpeed: 'Move Speed',
  cooldownReduction: 'Cooldown Reduction',
  lifesteal: 'Lifesteal',
}

export const STAT_UNITS: Record<StatKey, string> = {
  spiritPower: '',
  bulletDamage: '%',
  fireRate: '%',
  bulletResist: '%',
  spiritResist: '%',
  maxHealth: '',
  healthRegen: '/s',
  moveSpeed: '',
  cooldownReduction: '%',
  lifesteal: '%',
}

export const ALL_STAT_KEYS: StatKey[] = [
  'spiritPower',
  'bulletDamage',
  'fireRate',
  'bulletResist',
  'spiritResist',
  'maxHealth',
  'healthRegen',
  'moveSpeed',
  'cooldownReduction',
  'lifesteal',
]

export type ItemCategory = 'weapon' | 'vitality' | 'spirit'

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  weapon: 'Weapon',
  vitality: 'Vitality',
  spirit: 'Spirit',
}

export interface Item {
  id: string
  name: string
  category: ItemCategory
  tier: 1 | 2 | 3 | 4 | 5
  cost: number
  stats: Partial<Record<StatKey, number>>
  description: string
  /** WebP icon URL on the official Deadlock CDN; may be empty. */
  image: string
}

export type HeroArchetype = 'bullet' | 'spirit' | 'hybrid' | 'vitality'

export const ARCHETYPE_LABELS: Record<HeroArchetype, string> = {
  bullet: 'Bullet Damage',
  spirit: 'Spirit Caster',
  hybrid: 'Hybrid',
  vitality: 'Brawler / Tank',
}

export interface Hero {
  id: string
  name: string
  role: string
  archetype: HeroArchetype
  baseStats: {
    maxHealth: number
    moveSpeed: number
    healthRegen: number
  }
  /** Gained per standard upgrade; a level-L hero has had L-1 of them. */
  perLevel: {
    maxHealth: number
    spiritPower: number
    bulletDamage: number
  }
  defaultWeights: Partial<Record<StatKey, number>>
  /** WebP portrait URL on the official Deadlock CDN; may be empty. */
  image: string
}

export interface BuildResult {
  chosenItems: Item[]
  totalCost: number
  totalStats: Partial<Record<StatKey, number>>
  score: number
  slotsUsed: Record<ItemCategory, number>
  categorySpend: Record<ItemCategory, number>
  /** Cumulative investment bonus per category at the spend reached. */
  categoryInvestment: Record<ItemCategory, number>
  /** False in match-data mode, where the bonus is already inside the coefficients. */
  investmentBonusApplied: boolean
}

export type ScoringMode = 'stats' | 'learned'
