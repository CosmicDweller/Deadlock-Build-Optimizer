import type { BuildResult, Hero, ItemCategory, ScoringMode, StatKey } from '../types'
import { CATEGORY_LABELS, STAT_LABELS, STAT_UNITS, ALL_STAT_KEYS } from '../types'
import { INVESTMENT, nextInvestmentTier } from '../data/investmentBonuses'
import { MAX_SLOTS } from '../lib/optimizer'
import { computeBuildStats, investmentCategoryFor } from '../lib/statTotals'
import { learnedItemBreakdown, learnedItemValue } from '../lib/learnedScoring'
import type { ObjectiveWeights } from '../lib/learnedScoring'
import { GameIcon } from './GameIcon'
import { ProgressionView } from './ProgressionView'
import type { Progression } from '../lib/progression'

interface Props {
  result: BuildResult | null
  budget: number
  mode: ScoringMode
  objectives: ObjectiveWeights
  heroId: string | null
  metaWeight: number
  hero: Hero | null
  level: number
  progression: Progression | null
  view: BuildView
  onViewChange: (view: BuildView) => void
}

export type BuildView = 'final' | 'progression'

const CATEGORIES: ItemCategory[] = ['weapon', 'vitality', 'spirit']

function formatStat(key: StatKey, value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded.toLocaleString()}${STAT_UNITS[key]}`
}

export function BuildOutput({
  result,
  budget,
  mode,
  objectives,
  heroId,
  metaWeight,
  hero,
  level,
  progression,
  view,
  onViewChange,
}: Props) {
  if (!result || !hero) {
    return (
      <div className="panel build-output">
        <h2>Recommended Build</h2>
        <p className="empty-note">Pick a hero and set some priorities to generate a build.</p>
      </div>
    )
  }

  const remaining = budget - result.totalCost
  const hasAnyItems = result.chosenItems.length > 0
  const learned = mode === 'learned'
  const stats = computeBuildStats(hero, result.chosenItems, level)

  return (
    <div className="panel build-output">
      <div className="panel-header">
        <h2>Recommended Build</h2>
        <div className="mode-toggle build-view-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={view === 'final'}
            className={`mode-button${view === 'final' ? ' active' : ''}`}
            onClick={() => onViewChange('final')}
          >
            Final build
          </button>
          <button
            role="tab"
            aria-selected={view === 'progression'}
            className={`mode-button${view === 'progression' ? ' active' : ''}`}
            onClick={() => onViewChange('progression')}
          >
            Progression
          </button>
        </div>
        <div className="build-cost">
          <span>{result.totalCost.toLocaleString()} / {budget.toLocaleString()} souls</span>
          <span className="build-remaining">
            {result.chosenItems.length}/{MAX_SLOTS} slots · {remaining.toLocaleString()} left
          </span>
        </div>
      </div>

      {!hasAnyItems && (
        <p className="empty-note">
          {learned
            ? 'No items scored positively for this objective. Raise an objective slider above 0.'
            : 'Raise at least one priority slider above 0 to get item recommendations.'}
        </p>
      )}

      {view === 'progression' && progression && (
        <ProgressionView progression={progression} heroName={hero.name} />
      )}

      {view === 'final' && CATEGORIES.map((category) => {
        const items = result.chosenItems.filter((i) => i.category === category)
        const spend = result.categorySpend[category]
        const bonus = result.categoryInvestment[category]
        const spec = INVESTMENT[category]
        const next = nextInvestmentTier(category, spend)
        // Progress runs between the tier just cleared and the next one, so
        // the bar reads as distance to the upcoming step rather than to a
        // single fixed goal.
        const clearedSouls = [...spec.tiers].reverse().find((t) => spend >= t.souls)?.souls ?? 0
        const progressPct = next
          ? Math.min(100, ((spend - clearedSouls) / (next.souls - clearedSouls)) * 100)
          : 100
        const suffix = spec.unit === 'percent' ? '%' : ''

        return (
          <div className="category-block" key={category}>
            <h3 className={`category-title category-${category}`}>
              {CATEGORY_LABELS[category]} ({result.slotsUsed[category]} item
              {result.slotsUsed[category] === 1 ? '' : 's'})
            </h3>

            <div className="investment-bar">
              <div className="investment-track">
                <div
                  className={`investment-fill${bonus > 0 ? ' active' : ''}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="investment-label">
                <span>
                  {spend.toLocaleString()} invested
                  {next
                    ? ` · ${(next.souls - spend).toLocaleString()} to +${next.individual}${suffix}`
                    : ' · max tier'}
                  {next?.milestone ? ' (milestone)' : ''}
                </span>
                {result.investmentBonusApplied && bonus > 0 && (
                  <span className="investment-bonus-chips">
                    <span className="stat-chip investment-chip active">
                      {spec.label.replace(' (%)', '')} +{bonus}
                      {suffix}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {items.length === 0 ? (
              <p className="empty-note small">No items selected in this category.</p>
            ) : (
              <ul className="item-list">
                {items.map((item) => {
                  const value = learned
                    ? learnedItemValue(item, objectives, heroId, metaWeight)
                    : 0
                  const breakdown = learned
                    ? learnedItemBreakdown(item, objectives, heroId, metaWeight)
                    : []
                  return (
                    <li className="item-card" key={item.id}>
                      <div className="item-card-header">
                        <GameIcon className="item-icon" src={item.image} alt="" />
                        <span className="item-name">{item.name}</span>
                        {learned && (
                          <span className="item-value">
                            {value >= 0 ? '+' : ''}
                            {value.toFixed(2)}
                          </span>
                        )}
                        <span className="item-tier">T{item.tier}</span>
                        <span className="item-cost">{item.cost.toLocaleString()}</span>
                      </div>
                      <p className="item-description">{item.description}</p>
                      {learned && breakdown.length > 0 ? (
                        <div className="item-stats">
                          {breakdown.map((entry) => (
                            <span
                              className={`stat-chip value-chip${entry.value < 0 ? ' negative' : ''}`}
                              key={entry.target}
                            >
                              {entry.label} {entry.value >= 0 ? '+' : ''}
                              {entry.value.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="item-stats">
                          {Object.entries(item.stats).map(([key, statValue]) => (
                            <span className="stat-chip" key={key}>
                              {STAT_LABELS[key as keyof typeof STAT_LABELS]} +{statValue}
                              {STAT_UNITS[key as keyof typeof STAT_UNITS]}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}

      <div className="totals-block">
        <h3>
          Resulting Stats{' '}
          <span className="totals-level">
            {hero.name} at level {level}
          </span>
        </h3>
        <table className="stat-table">
          <thead>
            <tr>
              <th>Stat</th>
              <th>Base</th>
              <th>Level</th>
              <th>Items</th>
              <th>Invest</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {ALL_STAT_KEYS.map((key) => {
              const row = stats.totals[key]
              if (!row || row.total === 0) return null
              const category = investmentCategoryFor(key)
              const isPercentBonus =
                category !== null && INVESTMENT[category].unit === 'percent' && key === 'maxHealth'
              const investCell = isPercentBonus
                ? stats.investment.vitality
                  ? `×${(1 + stats.investment.vitality / 100).toFixed(2)}`
                  : '—'
                : row.fromInvestment
                  ? `+${Math.round(row.fromInvestment * 10) / 10}`
                  : '—'
              return (
                <tr key={key}>
                  <td className="stat-name">{STAT_LABELS[key]}</td>
                  <td>{row.base ? Math.round(row.base * 10) / 10 : '—'}</td>
                  <td>{row.fromLevel ? `+${Math.round(row.fromLevel)}` : '—'}</td>
                  <td>{row.fromItems ? `+${Math.round(row.fromItems * 10) / 10}` : '—'}</td>
                  <td>{investCell}</td>
                  <td className="stat-total">{formatStat(key, row.total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mode-footnote">
          Stacking was fitted against 119,630 real player records: health is
          (base + level + items) × the vitality percentage, which lands within about 1 HP of
          observed values. Weapon and spirit read slightly low because conditional and on-proc
          item effects never enter the passive stat block — treat those two as a floor.
        </p>
      </div>
    </div>
  )
}
