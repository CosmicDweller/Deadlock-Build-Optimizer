import type { Item } from '../types'

/**
 * Item upgrade paths, and the constraint they impose on a build.
 *
 * Many items are built from cheaper ones — Swift Striker (1600) upgrades
 * from Rapid Rounds (800). The component is consumed: it leaves your
 * inventory and frees its slot. So a legal build can never hold an item
 * together with one of its components, or with a component of a component.
 *
 * This is not an inference. Across 119,630 real builds there are 712,140
 * chances for a parent and its component to appear together, and it happens
 * exactly 0 times.
 *
 * Note this is NOT "at most one item per upgrade family". Siblings are
 * fine: Guardian Ward and Reactive Barrier both upgrade from Grit, and
 * holding both is legal — you simply buy Grit twice. The real rule is that
 * the chosen set must be an antichain in the ancestor graph, so families
 * are expanded into their valid combinations rather than collapsed to one
 * choice.
 *
 * `cost` on an item is always its FULL price, never the upgrade
 * difference. Component prices never sum to the parent's (0 of 62 items),
 * and for planning a finished build the full price is the right figure:
 * reaching Swift Striker really does cost 1600 total, whether or not you
 * stopped at Rapid Rounds on the way.
 */

export interface FamilyOption {
  items: Item[]
  /** Slots consumed; an antichain can hold several siblings. */
  count: number
  cost: number
}

export interface UpgradeFamily {
  items: Item[]
  options: FamilyOption[]
}

/** Guard against a pathological family making antichain enumeration blow up. */
const MAX_FAMILY_SIZE = 16

function ancestorSets(items: Item[]): Map<string, Set<string>> {
  const byId = new Map(items.map((item) => [item.id, item]))
  const cache = new Map<string, Set<string>>()

  const resolve = (id: string, seen: Set<string>): Set<string> => {
    const cached = cache.get(id)
    if (cached) return cached
    const out = new Set<string>()
    const item = byId.get(id)
    if (item && !seen.has(id)) {
      seen.add(id)
      for (const component of item.components) {
        // Components missing from the pool aren't selectable, so they can't
        // conflict — but their own ancestors still can.
        if (byId.has(component)) out.add(component)
        for (const deeper of resolve(component, seen)) out.add(deeper)
      }
      seen.delete(id)
    }
    cache.set(id, out)
    return out
  }

  for (const item of items) resolve(item.id, new Set())
  return cache
}

/** Parent/component pairs whose two items sit in different categories. */
export function crossCategoryConflicts(items: Item[]): [string, string][] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const ancestors = ancestorSets(items)
  const pairs: [string, string][] = []
  for (const item of items) {
    for (const ancestorId of ancestors.get(item.id) ?? []) {
      const ancestor = byId.get(ancestorId)
      if (ancestor && ancestor.category !== item.category) {
        pairs.push([item.id, ancestorId])
      }
    }
  }
  return pairs
}

/**
 * Group one category's items into upgrade families and enumerate the legal
 * combinations of each. Items with no upgrade relationships come back as
 * singleton families with two options (take it or don't), which is exactly
 * the plain 0/1 behaviour.
 */
export function buildFamilies(items: Item[]): UpgradeFamily[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const ancestors = ancestorSets(items)

  // Undirected adjacency over conflicting pairs, to find families.
  const adjacent = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!adjacent.has(a)) adjacent.set(a, new Set())
    adjacent.get(a)!.add(b)
  }
  for (const item of items) {
    for (const ancestorId of ancestors.get(item.id) ?? []) {
      if (!byId.has(ancestorId)) continue
      link(item.id, ancestorId)
      link(ancestorId, item.id)
    }
  }

  const families: UpgradeFamily[] = []
  const visited = new Set<string>()
  for (const item of items) {
    if (visited.has(item.id)) continue
    const members: Item[] = []
    const stack = [item.id]
    while (stack.length) {
      const id = stack.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      const member = byId.get(id)
      if (!member) continue
      members.push(member)
      for (const next of adjacent.get(id) ?? []) {
        if (!visited.has(next)) stack.push(next)
      }
    }
    families.push({ items: members, options: enumerateOptions(members, ancestors) })
  }
  return families
}

function enumerateOptions(
  members: Item[],
  ancestors: Map<string, Set<string>>,
): FamilyOption[] {
  const empty: FamilyOption = { items: [], count: 0, cost: 0 }
  if (members.length === 1) {
    const only = members[0]
    return [empty, { items: [only], count: 1, cost: only.cost }]
  }
  if (members.length > MAX_FAMILY_SIZE) {
    // Degenerate case: fall back to one-at-a-time so behaviour stays sane.
    return [empty, ...members.map((m) => ({ items: [m], count: 1, cost: m.cost }))]
  }

  const conflicts = (a: Item, b: Item) =>
    (ancestors.get(a.id)?.has(b.id) ?? false) || (ancestors.get(b.id)?.has(a.id) ?? false)

  const options: FamilyOption[] = []
  for (let mask = 0; mask < 1 << members.length; mask++) {
    const chosen: Item[] = []
    let ok = true
    for (let i = 0; i < members.length && ok; i++) {
      if (!(mask & (1 << i))) continue
      const candidate = members[i]
      for (const already of chosen) {
        if (conflicts(candidate, already)) {
          ok = false
          break
        }
      }
      if (ok) chosen.push(candidate)
    }
    if (!ok) continue
    options.push({
      items: chosen,
      count: chosen.length,
      cost: chosen.reduce((sum, i) => sum + i.cost, 0),
    })
  }
  return options
}
