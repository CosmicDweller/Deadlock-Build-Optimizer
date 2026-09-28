import type { BuildResult, ItemCategory, ScoringMode } from '../types'
import { CATEGORY_LABELS, STAT_LABELS, STAT_UNITS, ALL_STAT_KEYS } from '../types'
import { INVESTMENT_BONUSES, INVESTMENT_THRESHOLD } from '../data/investmentBonuses'
import { MAX_SLOTS } from '../lib/optimizer'
import { learnedItemBreakdown, learnedItemValue } from '../lib/learnedScoring'
import type { ObjectiveWeights } from '../lib/learnedScoring'
import { GameIcon } from './GameIcon'

interface Props {
  result: BuildResult | null
  budget: number
  mode: ScoringMode
  objectives: ObjectiveWeights
  heroId: string | null
  metaWeight: number
}

const CATEGORIES: ItemCategory[] = ['weapon', 'vitality', 'spirit']

export function BuildOutput({ result, budget, mode, objectives, heroId, metaWeight }: Props) {
  if (!result) {
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

  return (
    <div className="panel build-output">
      <div className="panel-header">
        <h2>Recommended Build</h2>
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

      {CATEGORIES.map((category) => {
        const items = result.chosenItems.filter((i) => i.category === category)
        const spend = result.categorySpend[category]
        const active = result.categoryBonusActive[category]
        const progressPct = Math.min(100, (spend / INVESTMENT_THRESHOLD) * 100)
        const bonus = INVESTMENT_BONUSES[category]
        return (
          <div className="category-block" key={category}>
            <h3 className={`category-title category-${category}`}>
              {CATEGORY_LABELS[category]} ({result.slotsUsed[category]} item
              {result.slotsUsed[category] === 1 ? '' : 's'})
            </h3>

            <div className="investment-bar">
              <div className="investment-track">
                <div
                  className={`investment-fill${active ? ' active' : ''}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="investment-label">
                <span>
                  {spend.toLocaleString()} / {INVESTMENT_THRESHOLD.toLocaleString()} invested
                  {active ? ' — bonus active' : ''}
                </span>
                {result.investmentBonusApplied && (
                  <span className="investment-bonus-chips">
                    {Object.entries(bonus.stats).map(([key, value]) => (
                      <span
                        className={`stat-chip investment-chip${active ? ' active' : ''}`}
                        key={key}
                      >
                        {STAT_LABELS[key as keyof typeof STAT_LABELS]} +{value}
                        {STAT_UNITS[key as keyof typeof STAT_UNITS]}
                      </span>
                    ))}
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
                        {learned && <span className="item-value">{value >= 0 ? '+' : ''}{value.toFixed(2)}</span>}
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

      {hasAnyItems && (
        <div className="totals-block">
          <h3>Total Build Stats</h3>
          <div className="totals-grid">
            {ALL_STAT_KEYS.filter((key) => (result.totalStats[key] ?? 0) !== 0).map((key) => (
              <div className="totals-row" key={key}>
                <span>{STAT_LABELS[key]}</span>
                <span>
                  +{result.totalStats[key]}
                  {STAT_UNITS[key]}
                </span>
              </div>
            ))}
          </div>
          {learned && (
            <p className="mode-footnote">
              Totals cover listed passive stats only. The build was chosen on learned values,
              which also capture active and conditional effects these totals can't show.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
