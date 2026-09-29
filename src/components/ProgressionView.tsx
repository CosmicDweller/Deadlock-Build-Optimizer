import type { Progression } from '../lib/progression'
import { GameIcon } from './GameIcon'

interface Props {
  progression: Progression
  heroName: string
}

const FATE_LABEL = {
  keeps: '',
  upgrades: 'upgrades',
  sold: 'sell',
} as const

export function ProgressionView({ progression, heroName }: Props) {
  const { phases, wastedSouls } = progression

  return (
    <div className="progression">
      <p className="mode-note">
        Phase budgets come from real purchase timings: the median player has spent 3,200 souls
        by minute 10, 14,400 by 22, and 33,600 by 36 — which is also about when games end.
      </p>

      {phases.map((phase) => (
        <div className="phase-block" key={phase.spec.key}>
          <div className="phase-header">
            <h3 className="phase-title">{phase.spec.label}</h3>
            <span className="phase-meta">
              by {phase.spec.minute}m · {phase.items.length} items ·{' '}
              {phase.spent.toLocaleString()} souls
            </span>
          </div>

          <ul className="item-list">
            {phase.items.map(({ item, fate, upgradesInto, isNew, builtFrom }) => (
              <li className={`phase-item${isNew ? ' new' : ''}`} key={item.id}>
                <GameIcon className="phase-icon" src={item.image} alt="" />
                <span className="phase-item-name">
                  {item.name}
                  {isNew && <span className="phase-new">new</span>}
                  {builtFrom && (
                    <span className="phase-via">
                      via {builtFrom.map((c) => c.name).join(' + ')}
                    </span>
                  )}
                </span>
                {fate !== 'keeps' && (
                  <span className={`phase-fate fate-${fate}`}>
                    {FATE_LABEL[fate]}
                    {upgradesInto ? ` → ${upgradesInto.name}` : ''}
                  </span>
                )}
                <span className="item-cost">{item.cost.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="mode-footnote">
        {wastedSouls > 0
          ? `${wastedSouls.toLocaleString()} souls go into items sold later rather than upgraded — normal, and roughly what real ${heroName} players do: 51% sell at least one item, typically a cheap laning pickup held about 23 minutes to free a slot.`
          : `Every purchase carries forward, either kept or upgraded into a later item.`}{' '}
        Early phases are scored on what this hero actually holds at that minute, since the
        endgame model has no concept of lane value.
      </p>
    </div>
  )
}
