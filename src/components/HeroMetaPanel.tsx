import { affinityFor, archetypesFor, heroGames } from '../lib/heroMeta'
import type { Hero } from '../types'
import { ITEMS } from '../data/items'
import { GameIcon } from './GameIcon'

const IMAGE_BY_ITEM_ID: Record<string, string> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item.image]),
)

interface Props {
  hero: Hero
}

export function HeroMetaPanel({ hero }: Props) {
  const affinity = affinityFor(hero.id)
  const archetypes = archetypesFor(hero.id)
  const games = heroGames(hero.id)

  if (affinity.length === 0) {
    return (
      <div className="panel meta-panel">
        <div className="panel-header">
          <h2>What {hero.name} Players Build</h2>
        </div>
        <p className="empty-note">Not enough {hero.name} games in the dataset.</p>
      </div>
    )
  }

  return (
    <div className="panel meta-panel">
      <div className="panel-header">
        <h2>What {hero.name} Players Build</h2>
        <span className="meta-games">{games} games</span>
      </div>

      <p className="mode-note">
        Items this hero buys far more than every other hero. Popularity, not proof — it
        captures kit synergies nothing else measures, but a playerbase can agree on a bad item.
      </p>

      <ul className="affinity-list">
        {affinity.slice(0, 8).map((entry) => (
          <li className="affinity-row" key={entry.item}>
            <span className={`affinity-lift category-${entry.category}`}>
              {entry.lift === null ? '∞' : `${entry.lift.toFixed(1)}×`}
            </span>
            <GameIcon
              className="affinity-icon"
              src={IMAGE_BY_ITEM_ID[entry.item] ?? ''}
              alt=""
            />
            <span className="affinity-name">{entry.name}</span>
            <span className="affinity-rates">
              {(entry.pick * 100).toFixed(0)}% vs {(entry.others * 100).toFixed(0)}%
              <span className="affinity-n"> n={entry.games}</span>
            </span>
          </li>
        ))}
      </ul>

      {archetypes && (
        <div className="archetype-block">
          <h3>Distinct Builds</h3>
          <p className="mode-note">
            This hero's games split into {archetypes.clusters.length} build patterns rather
            than one consensus.
          </p>
          {archetypes.clusters.map((cluster, i) => (
            <div className="archetype" key={i}>
              <div className="archetype-header">
                <span className="archetype-share">{(cluster.share * 100).toFixed(0)}%</span>
                <span className="archetype-meta">
                  {cluster.size} games · {(cluster.winRate * 100).toFixed(0)}% win
                </span>
              </div>
              <div className="item-stats">
                {cluster.signature.map((sig) => (
                  <span className="stat-chip" key={sig.name}>
                    {sig.name} {(sig.inRate * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="mode-footnote">
            Win rates here are descriptive and often rest on small samples — a gap between
            builds needs a lot more games before it means anything.
          </p>
        </div>
      )}
    </div>
  )
}
