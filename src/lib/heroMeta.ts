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

export interface CounterPick {
  /** How many times more often the item is bought against this hero. */
  lift: number
  with: number
  without: number
  games: number
}

export interface SoulCurvePoint {
  minute: number
  /** Median cumulative item spend by this minute. */
  souls: number
  /** Median item count held by this minute. */
  items: number
  samples: number
}

export interface LevelPoint {
  level: number
  /** Net worth at which players typically reach this level. */
  souls: number
}

interface BracketData {
  minBadge: number
  players: number
  heroGames: Record<string, number>
  levelByNetWorth: LevelPoint[]
  soulCurve: SoulCurvePoint[]
  affinity: Record<string, AffinityEntry[]>
  archetypes: Record<string, HeroArchetypes>
  metaScore: Record<string, Record<string, number>>
  /** phase minute -> hero -> item -> z-scored log-odds of being held then. */
  phaseMeta: Record<string, Record<string, Record<string, number>>>
  /** enemy hero -> item -> how much more it's bought against them. */
  counterPicks: Record<string, Record<string, CounterPick>>
}

interface HeroMetaFile {
  generated: string
  nMatches: number
  defaultBracket: SkillBracket
  brackets: Record<SkillBracket, BracketData>
}

/**
 * Skill brackets by the match's average badge.
 *
 * Players build differently enough that pooling them misleads. Against
 * sub-40 lobbies, 90+ players take Dispel Magic 10 points more often and
 * Counterspell twice as often, while Boundless Spirit drops 16 points:
 * strong players buy actives, utility and counters, weaker ones stack raw
 * stats. Low lobbies are the larger sample, so "all" leans toward
 * stat-stacking.
 *
 * Brackets are nested, not disjoint — a 90+ game also counts toward high
 * and all — which keeps each one's sample as large as possible.
 */
export type SkillBracket = 'all' | 'high' | 'top'

export const SKILL_BRACKETS: { key: SkillBracket; label: string; hint: string }[] = [
  { key: 'all', label: 'All ranks', hint: 'Every lobby in the sample' },
  { key: 'high', label: 'High', hint: 'Badge 70+, all heroes well sampled' },
  { key: 'top', label: 'Top', hint: 'Badge 90+, purest but thinner' },
]

export const HERO_META = rawHeroMeta as unknown as HeroMetaFile

function data(bracket: SkillBracket): BracketData {
  return HERO_META.brackets[bracket] ?? HERO_META.brackets.all
}

export function bracketPlayers(bracket: SkillBracket): number {
  return data(bracket).players
}

export function affinityFor(heroId: string | null, bracket: SkillBracket = 'all'): AffinityEntry[] {
  if (!heroId) return []
  return data(bracket).affinity[heroId] ?? []
}

export function archetypesFor(
  heroId: string | null,
  bracket: SkillBracket = 'all',
): HeroArchetypes | null {
  if (!heroId) return null
  // Clustering is only exported for the full sample; narrower brackets
  // lack the games to separate builds reliably.
  const own = data(bracket).archetypes[heroId]
  return own ?? HERO_META.brackets.all.archetypes[heroId] ?? null
}

export function heroGames(heroId: string | null, bracket: SkillBracket = 'all'): number {
  if (!heroId) return 0
  return data(bracket).heroGames[heroId] ?? 0
}

/**
 * The hero level a player with this much net worth typically has.
 *
 * Derived from observed medians rather than the game's own required_gold
 * curve: levels are paid for on a different accounting scale (418,700
 * souls for level 33 against a ~40,000 net worth), and the ratio between
 * the two drifts across the range, so the cost curve can't be rescaled.
 */
export function levelForSouls(souls: number, bracket: SkillBracket = 'all'): number {
  const curve = data(bracket).levelByNetWorth
  if (!curve.length) return 1
  let level = curve[0].level
  for (const point of curve) {
    if (souls >= point.souls) level = point.level
    else break
  }
  return level
}

export function soulCurve(bracket: SkillBracket = 'all'): SoulCurvePoint[] {
  return data(bracket).soulCurve
}

/**
 * How commonly this hero is holding an item at a given phase minute.
 *
 * Distinct from `metaScore`, which describes the finished build. The
 * endgame model has no concept of lane value, so without this a 10-minute
 * build is just the cheap corner of the late build.
 */
export function phaseMetaScore(
  minute: number,
  heroId: string | null,
  itemId: string,
  bracket: SkillBracket = 'all',
): number {
  if (!heroId) return 0
  const phase = data(bracket).phaseMeta?.[String(minute)]
  if (!phase) return metaScore(heroId, itemId, bracket)
  const hero = phase[heroId]
  if (!hero) return metaScore(heroId, itemId, bracket)
  return hero[itemId] ?? 0
}

export function metaScore(
  heroId: string | null,
  itemId: string,
  bracket: SkillBracket = 'all',
): number {
  if (!heroId) return 0
  return data(bracket).metaScore[heroId]?.[itemId] ?? 0
}


export interface CounterSuggestion {
  itemId: string
  /** Strongest lift across the selected enemies, and who drives it. */
  lift: number
  against: { heroId: string; lift: number; with: number; without: number }[]
}

/**
 * Items bought disproportionately often against a given enemy lineup.
 *
 * Pooled across the buying hero, so this is "what people take against
 * Haze" rather than "what Wraith takes against Haze" — counter-picks are
 * mostly universal, and pooling turns hundreds of games per pairing into
 * tens of thousands. It measures belief rather than proof: it reports what
 * players think answers a hero.
 */
export function counterSuggestions(
  enemyIds: string[],
  bracket: SkillBracket = 'all',
): CounterSuggestion[] {
  const merged = new Map<string, CounterSuggestion>()
  for (const heroId of enemyIds) {
    const picks = data(bracket).counterPicks?.[heroId]
    if (!picks) continue
    for (const [itemId, pick] of Object.entries(picks)) {
      const existing = merged.get(itemId)
      const entry = {
        heroId,
        lift: pick.lift,
        with: pick.with,
        without: pick.without,
      }
      if (existing) {
        existing.against.push(entry)
        existing.lift = Math.max(existing.lift, pick.lift)
      } else {
        merged.set(itemId, { itemId, lift: pick.lift, against: [entry] })
      }
    }
  }
  const out = [...merged.values()]
  for (const entry of out) entry.against.sort((a, b) => b.lift - a.lift)
  return out.sort((a, b) => b.lift - a.lift)
}
