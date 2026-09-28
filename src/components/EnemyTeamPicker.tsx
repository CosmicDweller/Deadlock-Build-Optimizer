import type { Hero } from '../types'
import { GameIcon } from './GameIcon'

export const MAX_ENEMIES = 6

interface Props {
  heroes: Hero[]
  selected: string[]
  onToggle: (heroId: string) => void
  onClear: () => void
}

export function EnemyTeamPicker({ heroes, selected, onToggle, onClear }: Props) {
  const selectedSet = new Set(selected)
  const full = selected.length >= MAX_ENEMIES

  return (
    <div className="panel enemy-panel">
      <div className="panel-header">
        <h2>Enemy Team</h2>
        {selected.length > 0 ? (
          <button className="link-button" onClick={onClear}>
            Clear ({selected.length}/{MAX_ENEMIES})
          </button>
        ) : (
          <span className="meta-games">optional</span>
        )}
      </div>

      <p className="mode-note">
        Pick who you're up against to get situational item suggestions. Left empty, the build
        ignores matchups entirely.
      </p>

      <div className="enemy-grid">
        {heroes.map((hero) => {
          const isSelected = selectedSet.has(hero.id)
          return (
            <button
              key={hero.id}
              className={`enemy-chip${isSelected ? ' selected' : ''}`}
              onClick={() => onToggle(hero.id)}
              disabled={!isSelected && full}
              title={hero.name}
              aria-pressed={isSelected}
            >
              <GameIcon className="enemy-icon" src={hero.image} alt={hero.name} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
