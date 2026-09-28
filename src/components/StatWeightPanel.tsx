import { ALL_STAT_KEYS, STAT_LABELS } from '../types'
import type { ScoringMode, StatKey } from '../types'
import { LEARNED, LEARNED_TARGETS } from '../lib/learnedScoring'
import type { ObjectiveWeights } from '../lib/learnedScoring'
import { MAX_HERO_LEVEL, MIN_HERO_LEVEL } from '../lib/statTotals'

interface Props {
  mode: ScoringMode
  onModeChange: (mode: ScoringMode) => void
  weights: Partial<Record<StatKey, number>>
  onChange: (key: StatKey, value: number) => void
  objectives: ObjectiveWeights
  onObjectiveChange: (key: string, value: number) => void
  metaWeight: number
  onMetaWeightChange: (value: number) => void
  onReset: () => void
  budget: number
  onBudgetChange: (value: number) => void
  level: number
  onLevelChange: (value: number) => void
}

export function StatWeightPanel({
  mode,
  onModeChange,
  weights,
  onChange,
  objectives,
  onObjectiveChange,
  metaWeight,
  onMetaWeightChange,
  onReset,
  budget,
  onBudgetChange,
  level,
  onLevelChange,
}: Props) {
  return (
    <div className="panel stat-panel">
      <div className="panel-header">
        <h2>Priorities</h2>
        <button className="link-button" onClick={onReset}>
          Reset to hero defaults
        </button>
      </div>

      <div className="mode-toggle" role="tablist">
        <button
          role="tab"
          aria-selected={mode === 'stats'}
          className={`mode-button${mode === 'stats' ? ' active' : ''}`}
          onClick={() => onModeChange('stats')}
        >
          Item stats
        </button>
        <button
          role="tab"
          aria-selected={mode === 'learned'}
          className={`mode-button${mode === 'learned' ? ' active' : ''}`}
          onClick={() => onModeChange('learned')}
        >
          Match data
        </button>
      </div>

      <p className="mode-note">
        {mode === 'stats'
          ? 'Scores items by the passive stats listed on them.'
          : `Scores items by what they actually produced across ${LEARNED.nMatches.toLocaleString()} real matches.`}
      </p>

      <div className="budget-row">
        <label htmlFor="budget-slider">Soul Budget</label>
        <input
          id="budget-slider"
          type="range"
          min={800}
          max={99999}
          step={100}
          value={budget}
          onChange={(e) => onBudgetChange(Number(e.target.value))}
        />
        <input
          className="budget-number"
          type="number"
          min={800}
          max={99999}
          step={100}
          value={budget}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (!Number.isNaN(value)) onBudgetChange(Math.min(99999, Math.max(800, value)))
          }}
        />
      </div>

      <div className="budget-row">
        <label htmlFor="hero-level">Hero Level</label>
        <input
          id="hero-level"
          type="range"
          min={MIN_HERO_LEVEL}
          max={MAX_HERO_LEVEL}
          step={1}
          value={level}
          onChange={(e) => onLevelChange(Number(e.target.value))}
        />
        <input
          className="budget-number"
          type="number"
          min={MIN_HERO_LEVEL}
          max={MAX_HERO_LEVEL}
          step={1}
          value={level}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (!Number.isNaN(value)) {
              onLevelChange(Math.min(MAX_HERO_LEVEL, Math.max(MIN_HERO_LEVEL, value)))
            }
          }}
        />
      </div>

      <div className="weight-grid">
        {mode === 'stats'
          ? ALL_STAT_KEYS.map((key) => (
              <div className="weight-row" key={key}>
                <label htmlFor={`weight-${key}`}>{STAT_LABELS[key]}</label>
                <input
                  id={`weight-${key}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[key] ?? 0}
                  onChange={(e) => onChange(key, Number(e.target.value))}
                />
                <span className="weight-value">{(weights[key] ?? 0).toFixed(2)}</span>
              </div>
            ))
          : LEARNED_TARGETS.map((target) => (
              <div className="weight-row" key={target.key}>
                <label htmlFor={`objective-${target.key}`} title={target.description}>
                  {target.label}
                  <span className={`r2-badge${target.r2 < 0.25 ? ' weak' : ''}`}>
                    R² {target.r2.toFixed(2)}
                  </span>
                </label>
                <input
                  id={`objective-${target.key}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={objectives[target.key] ?? 0}
                  onChange={(e) => onObjectiveChange(target.key, Number(e.target.value))}
                />
                <span className="weight-value">{(objectives[target.key] ?? 0).toFixed(2)}</span>
              </div>
            ))}
      </div>

      {mode === 'learned' && (
        <>
          <div className="weight-row meta-weight-row">
            <label htmlFor="meta-weight">
              Follow the meta
              <span className="r2-badge meta">pick rate</span>
            </label>
            <input
              id="meta-weight"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={metaWeight}
              onChange={(e) => onMetaWeightChange(Number(e.target.value))}
            />
            <span className="weight-value">{metaWeight.toFixed(2)}</span>
          </div>

          <p className="mode-footnote">
            R² is how much of each metric item choice actually explains. Low values mean the
            objective depends mostly on the player, not the build — treat those rankings as
            weak. "Follow the meta" pulls the build toward what this hero's players actually
            buy, which captures kit synergies the metrics can't see — at the cost of copying
            the crowd rather than optimizing.
          </p>
        </>
      )}
    </div>
  )
}
