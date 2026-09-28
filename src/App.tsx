import { useMemo, useState } from 'react'
import { HEROES } from './data/heroes'
import { ITEMS } from './data/items'
import { createStatScoring, optimizeBuild } from './lib/optimizer'
import {
  DEFAULT_OBJECTIVES_BY_ARCHETYPE,
  createLearnedScoring,
} from './lib/learnedScoring'
import type { ObjectiveWeights } from './lib/learnedScoring'
import { levelForSouls } from './lib/heroMeta'
import type { Hero, ScoringMode, StatKey } from './types'
import { HeroPicker } from './components/HeroPicker'
import { StatWeightPanel } from './components/StatWeightPanel'
import { BuildOutput } from './components/BuildOutput'
import type { BuildView } from './components/BuildOutput'
import { buildProgression } from './lib/progression'
import { HeroMetaPanel } from './components/HeroMetaPanel'
import { EnemyTeamPicker, MAX_ENEMIES } from './components/EnemyTeamPicker'
import './App.css'

// Median cumulative item spend at minute 36, which is also about when
// games end — i.e. what a full game actually affords.
const DEFAULT_BUDGET = 33600
const DEFAULT_META_WEIGHT = 0.3

function App() {
  const [selectedHero, setSelectedHero] = useState<Hero | null>(null)
  const [mode, setMode] = useState<ScoringMode>('learned')
  const [weights, setWeights] = useState<Partial<Record<StatKey, number>>>({})
  const [objectives, setObjectives] = useState<ObjectiveWeights>({})
  const [metaWeight, setMetaWeight] = useState(DEFAULT_META_WEIGHT)
  const [budget, setBudget] = useState(DEFAULT_BUDGET)
  // Level normally tracks the soul budget, since both come from farming.
  // A manual pick wins until it's cleared.
  const [levelOverride, setLevelOverride] = useState<number | null>(null)
  const [view, setView] = useState<BuildView>('progression')
  const [enemyIds, setEnemyIds] = useState<string[]>([])

  function handleSelectHero(hero: Hero) {
    setSelectedHero(hero)
    setWeights(hero.defaultWeights)
    setObjectives(DEFAULT_OBJECTIVES_BY_ARCHETYPE[hero.archetype])
  }

  function handleToggleEnemy(heroId: string) {
    setEnemyIds((prev) =>
      prev.includes(heroId)
        ? prev.filter((id) => id !== heroId)
        : prev.length >= MAX_ENEMIES
          ? prev
          : [...prev, heroId],
    )
  }

  function handleWeightChange(key: StatKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }))
  }

  function handleObjectiveChange(key: string, value: number) {
    setObjectives((prev) => ({ ...prev, [key]: value }))
  }

  function handleReset() {
    setLevelOverride(null)
    if (!selectedHero) return
    setWeights(selectedHero.defaultWeights)
    setObjectives(DEFAULT_OBJECTIVES_BY_ARCHETYPE[selectedHero.archetype])
    setMetaWeight(DEFAULT_META_WEIGHT)
  }

  const level = levelOverride ?? levelForSouls(budget)

  const result = useMemo(() => {
    if (!selectedHero) return null
    // Vitality investment is a percentage, so stat-mode scoring needs the
    // health it will apply to before it can be compared with flat item health.
    const referenceHealth =
      selectedHero.baseStats.maxHealth + selectedHero.perLevel.maxHealth * (level - 1)
    const scoring =
      mode === 'stats'
        ? createStatScoring(ITEMS, weights, referenceHealth)
        : createLearnedScoring(objectives, selectedHero.id, metaWeight)
    return optimizeBuild(ITEMS, scoring, budget)
  }, [selectedHero, mode, weights, objectives, metaWeight, budget, level])

  const progression = useMemo(() => {
    if (!selectedHero) return null
    const referenceHealth =
      selectedHero.baseStats.maxHealth + selectedHero.perLevel.maxHealth * (level - 1)
    const scoring =
      mode === 'stats'
        ? createStatScoring(ITEMS, weights, referenceHealth)
        : createLearnedScoring(objectives, selectedHero.id, metaWeight)
    return buildProgression(ITEMS, scoring, budget, selectedHero.id, metaWeight)
  }, [selectedHero, mode, weights, objectives, metaWeight, budget, level])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Deadlock Build Optimizer</h1>
        <p className="app-subtitle">
          Pick a hero, set your priorities and soul budget, and get a suggested item build —
          scored either off item stats or off what items actually produced in real matches.
        </p>
      </header>

      <main className="app-grid">
        <HeroPicker heroes={HEROES} selectedId={selectedHero?.id ?? null} onSelect={handleSelectHero} />

        {selectedHero && (
          <div className="mid-column">
            <StatWeightPanel
              mode={mode}
              onModeChange={setMode}
              weights={weights}
              onChange={handleWeightChange}
              objectives={objectives}
              onObjectiveChange={handleObjectiveChange}
              metaWeight={metaWeight}
              onMetaWeightChange={setMetaWeight}
              onReset={handleReset}
              budget={budget}
              onBudgetChange={setBudget}
              level={level}
              onLevelChange={setLevelOverride}
              levelIsAuto={levelOverride === null}
              onLevelAuto={() => setLevelOverride(null)}
            />
            <HeroMetaPanel hero={selectedHero} />
            <EnemyTeamPicker
              heroes={HEROES}
              selected={enemyIds}
              onToggle={handleToggleEnemy}
              onClear={() => setEnemyIds([])}
            />
          </div>
        )}

        <BuildOutput
          result={result}
          budget={budget}
          mode={mode}
          objectives={objectives}
          heroId={selectedHero?.id ?? null}
          metaWeight={metaWeight}
          hero={selectedHero}
          level={level}
          progression={progression}
          view={view}
          onViewChange={setView}
          heroes={HEROES}
          enemyIds={enemyIds}
        />
      </main>

      <footer className="app-footer">
        <p>
          Item and hero data is generated from official Deadlock API exports by{' '}
          <code>scripts/generate_data.py</code>. Match-data item values come from{' '}
          <code>ml/train.py</code> and are associations conditional on budget, not causal
          effects. In stat mode, only unconditional passive stats are modeled, so items whose
          value is an active or situational effect are undervalued.
        </p>
      </footer>
    </div>
  )
}

export default App
