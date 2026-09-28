import type { Hero, Item } from '../types'
import { counterSuggestions } from '../lib/heroMeta'
import type { SkillBracket } from '../lib/heroMeta'
import { GameIcon } from './GameIcon'

interface Props {
  items: Item[]
  heroes: Hero[]
  enemyIds: string[]
  /** Items already in the recommended build, so they can be marked. */
  inBuild: Set<string>
  bracket: SkillBracket
}

const MAX_SHOWN = 8

/**
 * Items people reach for against this particular enemy lineup.
 *
 * Deliberately kept beside the build rather than folded into it. A
 * counter-pick's worth swings on game state in a way a fixed twelve-slot
 * recommendation can't express, and real build guides treat these as an
 * optional group for the same reason.
 */
export function SituationalItems({ items, heroes, enemyIds, inBuild, bracket }: Props) {
  if (enemyIds.length === 0) return null

  const byId = new Map(items.map((i) => [i.id, i]))
  const heroName = new Map(heroes.map((h) => [h.id, h.name]))
  const suggestions = counterSuggestions(enemyIds, bracket)
    .filter((s) => byId.has(s.itemId))
    .slice(0, MAX_SHOWN)

  if (suggestions.length === 0) {
    return (
      <div className="situational">
        <h3>Situational</h3>
        <p className="empty-note small">
          No item stands out against this lineup. Only pairings seen in at least 400 games
          with a meaningful gap are listed, so quieter counters won't appear.
        </p>
      </div>
    )
  }

  return (
    <div className="situational">
      <h3>Situational</h3>
      <p className="mode-note">
        Bought disproportionately often against these heroes. Popularity, not proof — this is
        what players reach for, pooled across every hero who buys it.
      </p>
      <ul className="item-list">
        {suggestions.map(({ itemId, against }) => {
          const item = byId.get(itemId)!
          const owned = inBuild.has(itemId)
          return (
            <li className="phase-item situational-item" key={itemId}>
              <GameIcon className="phase-icon" src={item.image} alt="" />
              <span className="phase-item-name">
                {item.name}
                {owned && <span className="phase-new">in build</span>}
              </span>
              <span className="situational-against">
                {against
                  .slice(0, 2)
                  .map((a) => `${a.lift.toFixed(1)}× vs ${heroName.get(a.heroId) ?? a.heroId}`)
                  .join(', ')}
                {against.length > 2 ? ` +${against.length - 2}` : ''}
              </span>
              <span className="item-cost">{item.cost.toLocaleString()}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
