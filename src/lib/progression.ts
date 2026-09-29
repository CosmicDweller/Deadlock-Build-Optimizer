import type { Item } from '../types'
import type { ScoringModel } from './optimizer'
import { MAX_SLOTS, optimizeBuild } from './optimizer'
import { phaseMetaScore, soulCurve } from './heroMeta'
import type { SkillBracket } from './heroMeta'

/**
 * A build split into laning / mid / late, rather than one endgame snapshot.
 *
 * Phase boundaries and budgets come from purchase timings across 10,000
 * matches. Median cumulative item spend runs 3,200 by minute 10, 14,400 by
 * 22 and 33,600 by 36, which is also about where games end (median 36
 * minutes). The median player has bought nothing at all by minute 5.
 *
 * Early phases are walked forward as souls arrive rather than handed the
 * phase budget as a lump sum. That distinction is the whole reason builds
 * open on tier 1 items: at minute 6 the median player has 800 souls, which
 * buys exactly one tier 1, and sitting on souls wastes lane time. Optimizing
 * the minute-10 end state instead let the search save up and open on tier 2s,
 * which 96.3% of real players do not do — they buy a tier 1 first, and a
 * median of two before their first tier 2.
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
  /**
   * Components bought and consumed within this phase to reach this item.
   * Carried on the parent rather than listed separately: they are no
   * longer held, so a row of their own would imply you own both and
   * inflate the phase's item count.
   */
  builtFrom?: Item[]
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
export function soulsByMinute(minute: number, bracket: SkillBracket = 'all'): number {
  const curve = soulCurve(bracket)
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
function phaseBudgets(budget: number, bracket: SkillBracket): number[] {
  const endSouls = soulsByMinute(PHASES[PHASES.length - 1].minute, bracket) || 1
  return PHASES.map((phase) =>
    Math.round((soulsByMinute(phase.minute, bracket) / endSouls) * budget),
  )
}

/**
 * Score bonus for an early item that survives into the final build, either
 * as itself or by upgrading. Sized to break ties toward continuity without
 * overriding a clearly stronger dead-end pick.
 */
const CONTINUITY_BONUS = 0.15

/** Minute the walk starts; before this the median player owns nothing. */
const WALK_START_MINUTE = 4

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
  bracket: SkillBracket = 'all',
  maxSlots?: number,
): Progression {
  const budgets = phaseBudgets(budget, bracket)
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
      const phaseMeta = phaseMetaScore(minute, heroId, item.id, bracket) * metaWeight
      const carries = finalIds.has(item.id) || upgradeTarget.has(item.id)
      return base + phaseMeta + (carries ? CONTINUITY_BONUS : 0)
    },
  })

  // Souls arrive on the measured curve, so the early game is walked minute
  // by minute and each step spends what is actually on hand. The late phase
  // stays a full optimization: it is the destination the walk aims at.
  const slotCap = maxSlots ?? MAX_SLOTS
  const earlyPhases = PHASES.slice(0, -1)
  const walked = walkSoulCurve(
    allItems,
    earlyPhases.map((phase, index) => ({
      minute: phase.minute,
      budget: budgets[index],
      scoring: phaseScoring(phase.minute),
    })),
    budget,
    slotCap,
    bracket,
  )
  const phaseSets: Item[][] = [...walked.map((w) => w.owned), final.chosenItems]
  const consumedByPhase = [...walked.map((w) => w.consumedInPhase), []]

  let wastedSouls = 0
  const phases: BuildPhase[] = phaseSets.map((items, index) => {
    const previous = index > 0 ? new Set(phaseSets[index - 1].map((i) => i.id)) : new Set<string>()
    const next = index < phaseSets.length - 1 ? phaseSets[index + 1] : null
    const nextIds = next ? new Set(next.map((i) => i.id)) : null
    const nextUpgrades = next ? componentIds(next) : null

    // Components bought and consumed inside this phase, grouped under the
    // item they became. A component carried in from an earlier phase is
    // skipped: that phase already lists it with its upgrade target.
    const builtFrom = new Map<string, Item[]>()
    for (const { item, target } of consumedByPhase[index] ?? []) {
      if (previous.has(item.id)) continue
      const list = builtFrom.get(target.id) ?? []
      list.push(item)
      builtFrom.set(target.id, list)
    }

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
      return {
        item,
        fate,
        upgradesInto,
        isNew: !previous.has(item.id),
        builtFrom: builtFrom.get(item.id),
      }
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


interface WalkStop {
  minute: number
  budget: number
  scoring: ScoringModel
}

/** Ancestors of an item that are present in `owned`, which it would consume. */
function consumedBy(item: Item, owned: Item[], byId: Map<string, Item>): Item[] {
  const ancestors = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (depth > 4) return
    for (const component of byId.get(id)?.components ?? []) {
      if (ancestors.has(component)) continue
      ancestors.add(component)
      visit(component, depth + 1)
    }
  }
  visit(item.id, 0)
  return owned.filter((o) => ancestors.has(o.id))
}

/** True if `owned` already contains something this item upgrades into. */
function wouldDowngrade(item: Item, owned: Item[], byId: Map<string, Item>): boolean {
  return owned.some((o) => consumedBy(o, [item], byId).length > 0)
}

/**
 * Buy forward along the soul curve, snapshotting at each stop.
 *
 * Purchases are greedy by score, which is the point rather than a
 * shortcut: a player at minute 6 with 800 souls picks the best thing 800
 * souls buys, not the best thing they could own by minute 10. Upgrading
 * charges only the difference and reclaims the component's slot, matching
 * how the shop actually works.
 */
interface WalkSnapshot {
  owned: Item[]
  /** Bought and upgraded away inside this same phase, so never in `owned`. */
  consumedInPhase: { item: Item; target: Item }[]
}

function walkSoulCurve(
  allItems: Item[],
  stops: WalkStop[],
  budget: number,
  slotCap: number,
  bracket: SkillBracket,
): WalkSnapshot[] {
  const byId = new Map(allItems.map((i) => [i.id, i]))
  const endSouls = soulsByMinute(PHASES[PHASES.length - 1].minute, bracket) || 1
  const scale = budget / endSouls

  let owned: Item[] = []
  let spent = 0
  const snapshots: WalkSnapshot[] = []

  for (const stop of stops) {
    const consumedInPhase: { item: Item; target: Item }[] = []
    // Every curve sample up to this stop, so souls trickle in rather than
    // landing all at once at the phase boundary.
    const steps = soulCurve(bracket)
      .filter((point) => point.minute >= WALK_START_MINUTE && point.minute <= stop.minute)
      .map((point) => Math.round(point.souls * scale))
    if (!steps.length) steps.push(stop.budget)
    steps[steps.length - 1] = stop.budget

    for (const available of steps) {
      // Keep buying while this step's souls still cover something useful.
      for (;;) {
        const ownedIds = new Set(owned.map((o) => o.id))
        const legal = (item: Item) =>
          !ownedIds.has(item.id) && !wouldDowngrade(item, owned, byId)

        let best: { item: Item; cost: number; score: number } | null = null
        // The best item regardless of price — what you're saving toward.
        let aspiration: Item | null = null
        let aspirationScore = 0
        for (const item of allItems) {
          if (!legal(item)) continue
          const consumed = consumedBy(item, owned, byId)
          const cost = item.cost - consumed.reduce((sum, c) => sum + c.cost, 0)
          if (cost <= 0) continue
          if (owned.length - consumed.length >= slotCap) continue
          const score = stop.scoring.scoreItem(item)
          if (score <= 0) continue
          if (score > aspirationScore) {
            aspiration = item
            aspirationScore = score
          }
          if (spent + cost > available) continue
          if (!best || score > best.score) best = { item, cost, score }
        }

        // If what you actually want is out of reach, buy its component and
        // upgrade later rather than banking souls or settling for an
        // unrelated item. That is what players do: 77.7% of parents are
        // reached through a component rather than bought outright.
        if (aspiration && (!best || best.item.id !== aspiration.id)) {
          const stepping = (aspiration.components ?? [])
            .map((id) => byId.get(id))
            .filter((c): c is Item => !!c && legal(c))
            .map((c) => ({
              item: c,
              cost: c.cost - consumedBy(c, owned, byId).reduce((sum, x) => sum + x.cost, 0),
              score: stop.scoring.scoreItem(c),
            }))
            .filter((c) => c.cost > 0 && spent + c.cost <= available)
            .sort((a, b) => b.score - a.score)[0]
          if (stepping) best = stepping
        }

        if (!best) break
        // Upgrading swallows the components it was built from. Those are
        // recorded rather than dropped: a tier 1 bought at minute 6 and
        // upgraded by minute 10 was still a real part of the laning build,
        // and hiding it is what made builds look like they opened on tier 2.
        const swallowed = consumedBy(best.item, owned, byId)
        const swallowedIds = new Set(swallowed.map((c) => c.id))
        for (const component of swallowed) {
          consumedInPhase.push({ item: component, target: best.item })
        }
        owned = owned.filter((o) => !swallowedIds.has(o.id))
        owned.push(best.item)
        spent += best.cost
      }
    }
    snapshots.push({ owned: [...owned], consumedInPhase })
  }
  return snapshots
}
