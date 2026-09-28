# Deadlock Build Optimizer

Suggests item builds for a Deadlock hero — either as a finished endgame
build or as a laning → mid → late progression — using item values learned
from 10,000 real matches.

Two halves that talk through generated data files:

- **Web app** (React + Vite) — pick a hero, set priorities, budget and
  skill bracket, get a build.
- **ML pipeline** (Python) — parses the match dump, fits the models, and
  exports what the web app reads.

The web app runs on committed data and needs nothing from Python. You only
need the pipeline to retrain on fresher matches.

## Running the web app

```bash
npm install
npm run dev
```

Everything it needs is committed (`src/data/*.ts`, `src/data/*.json`), so
this works on a fresh clone.

## Running the pipeline

The raw exports are **not** committed — the match dump alone is 1.2GB, well
past GitHub's file limit — so this part needs data first. Put these in
`data/raw/`:

| file | what it is |
| --- | --- |
| `deadlock_matches.json` | match dump (array of matches, each with `players`) |
| `deadlock_items.json` | item catalog from the Deadlock API |
| `deadlock_heroes.json` | hero catalog from the Deadlock API |
| `deadlock_investment.json` | soul-investment bonus table |

Then:

```bash
python3 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt
```

### Regenerating everything

```bash
python3 scripts/generate_data.py      # heroes/items/investment -> src/data/*.ts
ml/.venv/bin/python ml/train.py --rebuild   # parse matches, fit models
ml/.venv/bin/python ml/export_values.py     # -> src/data/learnedValues.json
ml/.venv/bin/python ml/export_hero_meta.py  # -> src/data/heroMeta.json
```

`--rebuild` re-parses the match dump (streamed, ~15s) instead of reusing
the parquet cache in `ml/cache/`. Run it after dropping in new matches.

### Exploring from the CLI

```bash
ml/.venv/bin/python ml/recommend.py --hero Infernus --budget 20000
ml/.venv/bin/python ml/recommend.py --hero Haze --weights "dps=1,weapon_power=0.5" --explain
ml/.venv/bin/python ml/hero_report.py --hero Abrams --archetypes
ml/.venv/bin/python ml/hero_report.py --hero Abrams --item "Arcane Surge"
```

`hero_report.py` shows four views of one hero: item affinity, build
archetypes, win-rate correlations and performance residuals. They fail in
different ways, so an item strong across several is the believable one.

## How builds are scored

Two modes, switchable in the app:

- **Item stats** — the passive stats printed on each item, weighted by
  sliders.
- **Match data** (default) — ridge regressions over 119,630 player-rows
  predicting end-of-match performance: ability/bullet DPS, ability reach,
  weapon/spirit/vitality stats, mitigation, healing. A "follow the meta"
  slider blends in how often the hero's players actually buy each item.

Win/loss is deliberately **not** the objective. Item choice moves it by
+0.003 AUC over economy controls alone — it's dominated by teammates and
snowballing. Performance metrics carry far more signal (weapon power
R² 0.79, healing 0.73, ability DPS 0.64).

Two confounds shape the design: winners buy more and pricier items, so net
worth is a control; and at fixed net worth an expensive item means fewer
items, so build size and total spend are controls too. Features are
demeaned within each match, and CV folds are grouped by match.

## Things worth knowing

- **Coefficients are associations conditional on budget, not causal
  effects.** Pick-rate signals measure what players believe, and will
  faithfully reproduce a wrong consensus.
- **Skill bracket matters more than expected.** Strong players buy actives
  and counters; weaker players stack raw stats. Pooling favours the latter
  because low lobbies are the larger sample, so the bracket selector
  changes recommendations meaningfully.
- **Only unconditional passive stats are mapped** from the item catalog.
  Items whose value is an active, on-proc or conditional effect are
  undervalued in stat mode and reach the optimizer only through pick rate.
- **Constraints come from the data**, not assumption: 12 total item slots
  shared across categories, and an item can never be held alongside a
  component it was upgraded from.
- **Item and hero data drift with patches.** Re-run
  `scripts/generate_data.py` after refreshing the raw exports rather than
  hand-editing the generated `.ts` files.

## Layout

```
src/
  lib/optimizer.ts       knapsack over budget + 12 slots + upgrade paths
  lib/progression.ts     laning/mid/late, walked along the soul curve
  lib/statTotals.ts      base + level + items + investment -> real stat values
  lib/learnedScoring.ts  item values from the match-data model
  lib/heroMeta.ts        per-hero pick rates, counters, curves, brackets
  data/                  generated; do not hand-edit
ml/
  deadlock_ml/           dataset, model, affinity, archetypes, optimizer
  train.py               fit and save
  export_*.py            write the web app's data files
  hero_report.py         per-hero analysis in the terminal
scripts/generate_data.py catalog -> typed data for the web app
```

## License

MIT
