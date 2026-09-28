import rawHeroMeta from '../data/heroMeta.json'

/**
 * Per-hero build meta mined from real matches by ml/export_hero_meta.py.
 *
 * Pick rate is the strongest hero-specific signal in the match data: it's
 * independent of match outcome, and effect sizes run 5-35x rather than a
 * few percent. It measures what players collectively believe about a hero
 * — which is how it catches kit synergies no stat or performance metric
 * encodes, and equally why it will report a playerbase agreeing on a bad
 * item with the same confidence.
 */
export interface AffinityEntry {
  item: string
  name: string
  category: string
  cost: number
  games: number
  /** Share of this hero's games that bought it. */
  pick: number
  /** Share of every other hero's games that bought it. */
  others: number
  lift: number | null
  winRate: number
  significant: boolean
}

export interface ArchetypeCluster {
  size: number
  share: number
  winRate: number
  signature: { name: string; inRate: number; outRate: number }[]
}

export interface HeroArchetypes {
  silhouette: number
  clusters: ArchetypeCluster[]
}

export interface LevelPoint {
  level: number
  /** Net worth at which players typically reach this level. */
  souls: number
}

interface HeroMetaFile {
  generated: string
  nMatches: number
  heroGames: Record<string, number>
  levelByNetWorth: LevelPoint[]
  affinity: Record<string, AffinityEntry[]>
  /** Only heroes whose builds actually separate into distinct clusters. */
  archetypes: Record<string, HeroArchetypes>
  /** hero -> item -> z-scored log pick-rate lift, for blending into scoring. */
  metaScore: Record<string, Record<string, number>>
}

export const HERO_META = rawHeroMeta as HeroMetaFile

export function affinityFor(heroId: string | null): AffinityEntry[] {
  if (!heroId) return []
  return HERO_META.affinity[heroId] ?? []
}

export function archetypesFor(heroId: string | null): HeroArchetypes | null {
  if (!heroId) return null
  return HERO_META.archetypes[heroId] ?? null
}

export function heroGames(heroId: string | null): number {
  if (!heroId) return 0
  return HERO_META.heroGames[heroId] ?? 0
}

/**
 * The hero level a player with this much net worth typically has.
 *
 * Derived from observed medians in the match data rather than the game's
 * own required_gold curve: levels are paid for on a different accounting
 * scale (418,700 souls for level 33, against a ~40,000 net worth at that
 * level), and the ratio between the two drifts across the range, so the
 * cost curve can't simply be rescaled.
 */
export function levelForSouls(souls: number): number {
  const curve = HERO_META.levelByNetWorth
  if (!curve.length) return 1
  let level = curve[0].level
  for (const point of curve) {
    if (souls >= point.souls) level = point.level
    else break
  }
  return level
}

export function metaScore(heroId: string | null, itemId: string): number {
  if (!heroId) return 0
  return HERO_META.metaScore[heroId]?.[itemId] ?? 0
}
