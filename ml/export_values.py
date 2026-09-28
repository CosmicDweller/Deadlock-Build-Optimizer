#!/usr/bin/env python3
"""Export learned item values for the web app to consume.

    python ml/export_values.py

Writes src/data/learnedValues.json, keyed by the same identifiers the web
app uses (item class_name, hero class_name minus the "hero_" prefix) so the
TypeScript side can look values up directly against its own catalog.

Near-zero hero adjustments are dropped: they're shrunken residuals that
round to noise, and keeping them would triple the payload for no effect on
which build wins.
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import joblib

from deadlock_ml.catalog import load_heroes, load_items
from deadlock_ml.targets import TARGETS

MODEL_PATH = Path(__file__).resolve().parent / "models" / "performance_model.joblib"
OUT_PATH = Path(__file__).resolve().parent.parent / "src" / "data" / "learnedValues.json"

ADJUSTMENT_CUTOFF = 0.01


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cutoff", type=float, default=ADJUSTMENT_CUTOFF,
                        help="drop hero adjustments smaller than this")
    args = parser.parse_args()

    if not MODEL_PATH.exists():
        raise SystemExit("No trained model found. Run: python ml/train.py")
    model = joblib.load(MODEL_PATH)

    items = load_items()
    heroes = load_heroes()
    hero_slug = {
        h.hero_id: h.class_name.removeprefix("hero_") for h in heroes.values()
    }

    # Target keys are indexed rather than spelled out: they repeat tens of
    # thousands of times across the adjustment table, and the index maps back
    # through the order of the "targets" array below.
    target_index = {key: str(i) for i, key in enumerate(TARGETS)}

    item_values: dict[str, dict[str, float]] = {}
    for item_id, item in items.items():
        per_target = {}
        for target, fit in model.fits.items():
            coef = fit.item_coefficients.get(item_id, 0.0)
            if coef:
                per_target[target_index[target]] = round(coef, 4)
        if per_target:
            item_values[item.class_name] = per_target

    hero_adjustments: dict[str, dict[str, dict[str, float]]] = {}
    for target, fit in model.fits.items():
        for (hero_id, item_id), value in fit.hero_adjustments.items():
            if abs(value) < args.cutoff:
                continue
            slug = hero_slug.get(hero_id)
            item = items.get(item_id)
            if slug is None or item is None:
                continue
            hero_adjustments.setdefault(slug, {}).setdefault(item.class_name, {})[
                target_index[target]
            ] = round(value, 4)

    payload = {
        "generated": date.today().isoformat(),
        "nRows": model.n_rows,
        "nMatches": model.n_matches,
        "targets": [
            {
                "key": key,
                "label": target.label,
                "description": target.description,
                "r2": round(model.fits[key].r2_cv, 3),
            }
            for key, target in TARGETS.items()
        ],
        "itemCounts": {
            items[i].class_name: n for i, n in model.item_counts.items() if i in items
        },
        "heroGames": {
            hero_slug[h]: n for h, n in model.hero_game_counts.items() if h in hero_slug
        },
        "items": item_values,
        "heroAdjustments": hero_adjustments,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    kb = OUT_PATH.stat().st_size / 1024
    n_adj = sum(len(t) for h in hero_adjustments.values() for t in h.values())
    print(f"Wrote {OUT_PATH} ({kb:.0f} KB)")
    print(f"  {len(item_values)} items x {len(TARGETS)} targets")
    print(f"  {n_adj:,} hero adjustments over {len(hero_adjustments)} heroes "
          f"(cutoff {args.cutoff})")


if __name__ == "__main__":
    main()
