import { useMemo, useState } from 'react'
import type { Hero } from '../types'
import { ARCHETYPE_LABELS } from '../types'

interface Props {
  heroes: Hero[]
  selectedId: string | null
  onSelect: (hero: Hero) => void
}

export function HeroPicker({ heroes, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return heroes
    return heroes.filter(
      (h) => h.name.toLowerCase().includes(q) || h.role.toLowerCase().includes(q),
    )
  }, [heroes, query])

  return (
    <div className="panel hero-picker">
      <div className="panel-header">
        <h2>Hero</h2>
        <input
          className="hero-search"
          type="text"
          placeholder="Search heroes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="hero-grid">
        {filtered.map((hero) => (
          <button
            key={hero.id}
            className={`hero-tile${hero.id === selectedId ? ' selected' : ''}`}
            onClick={() => onSelect(hero)}
            title={hero.role}
          >
            <span className="hero-name">{hero.name}</span>
            <span className={`hero-archetype archetype-${hero.archetype}`}>
              {ARCHETYPE_LABELS[hero.archetype]}
            </span>
          </button>
        ))}
        {filtered.length === 0 && <div className="empty-note">No heroes match "{query}".</div>}
      </div>
    </div>
  )
}
