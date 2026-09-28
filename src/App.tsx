import { useMemo, useState } from 'react'
import { HEROES } from './data/heroes'
import { ITEMS } from './data/items'
import { createStatScoring, optimizeBuild } from './lib/optimizer'
import {
  DEFAULT_OBJECTIVES_BY_ARCHETYPE,
  createLearnedScoring,
} from './lib/learnedScoring'
import type { ObjectiveWeights } from './lib/learnedScoring'
import type { Hero, ScoringMode, StatKey } from './types'
import { HeroPicker } from './components/HeroPicker'
import { StatWeightPanel } from './components/StatWeightPanel'
import { BuildOutput } from './components/BuildOutput'
import { HeroMetaPanel } from './components/HeroMetaPanel'
import './App.css'

const DEFAULT_BUDGET = 20000
const DEFAULT_META_WEIGHT = 0.3

function App() {
  const [selectedHero, setSelectedHero] = useState<Hero | null>(null)
  const [mode, setMode] = useState<ScoringMode>('learned')
  const [weights, setWeights] = useState<Partial<Record<StatKey, number>>>({})
  const [objectives, setObjectives] = useState<ObjectiveWeights>({})
  const [metaWeight, setMetaWeight] = useState(DEFAULT_META_WEIGHT)
  const [budget, setBudget] = useState(DEFAULT_BUDGET)

  function handleSelectHero(hero: Hero) {
    setSelectedHero(hero)
    setWeights(hero.defaultWeights)
    setObjectives(DEFAULT_OBJECTIVES_BY_ARCHETYPE[hero.archetype])
  }

  function handleWeightChange(key: StatKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }))
  }

  function handleObjectiveChange(key: string, value: number) {
    setObjectives((prev) => ({ ...prev, [key]: value }))
  }

  function handleReset() {
    if (!selectedHero) return
    setWeights(selectedHero.defaultWeights)
    setObjectives(DEFAULT_OBJECTIVES_BY_ARCHETYPE[selectedHero.archetype])
    setMetaWeight(DEFAULT_META_WEIGHT)
  }

  const result = useMemo(() => {
    if (!selectedHero) return null
    const scoring =
      mode === 'stats'
        ? createStatScoring(ITEMS, weights)
        : createLearnedScoring(objectives, selectedHero.id, metaWeight)
    return optimizeBuild(ITEMS, scoring, budget)
  }, [selectedHero, mode, weights, objectives, metaWeight, budget])

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
            />
            <HeroMetaPanel hero={selectedHero} />
          </div>
        )}

        <BuildOutput
          result={result}
          budget={budget}
          mode={mode}
          objectives={objectives}
          heroId={selectedHero?.id ?? null}
          metaWeight={metaWeight}
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
