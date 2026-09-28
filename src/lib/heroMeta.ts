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

interface HeroMetaFile {
  generated: string
  nMatches: number
  heroGames: Record<string, number>
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

export function metaScore(heroId: string | null, itemId: string): number {
  if (!heroId) return 0
  return HERO_META.metaScore[heroId]?.[itemId] ?? 0
}
