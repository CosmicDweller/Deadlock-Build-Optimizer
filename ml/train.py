#!/usr/bin/env python3
"""Build the dataset, fit the per-metric item models, save them.

    python ml/train.py [--rebuild] [--alpha 10] [--skip-eval]

--rebuild re-parses data/raw/deadlock_matches.json instead of using the
parquet cache (do this after dropping in fresh match data).

Objectives are performance metrics off the end-of-match stat sheet — DPS,
final damage, weapon/spirit/vitality stats, mitigation, healing — not match
outcome. R^2 is cross-validated with folds grouped by match.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib

from deadlock_ml.catalog import load_items
from deadlock_ml.dataset import load_player_table
from deadlock_ml.model import train
from deadlock_ml.targets import TARGETS

MODEL_PATH = Path(__file__).resolve().parent / "models" / "performance_model.joblib"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true", help="re-parse raw match JSON")
    parser.add_argument("--alpha", type=float, default=10.0, help="ridge strength")
    parser.add_argument("--skip-eval", action="store_true", help="skip cross-validation")
    parser.add_argument("--top", type=int, default=5, help="items to list per target")
    args = parser.parse_args()

    print("Loading player table...")
    df = load_player_table(rebuild=args.rebuild)
    print(f"  {len(df):,} player-rows across {df['match_id'].nunique():,} matches")
    print(f"  {df['hero_id'].nunique()} heroes, {len(load_items())} shop items")
    print(f"  mean build size: {df['items'].apply(len).mean():.1f} items")

    print(f"\nFitting {len(TARGETS)} objective models...")
    model = train(df, alpha=args.alpha, evaluate=not args.skip_eval)

    catalog = load_items()
    print(f"\n{'target':<14} {'cv R^2':>7}   top items (coefficient in target SDs)")
    print("-" * 78)
    for name, target in TARGETS.items():
        fit = model.fits[name]
        ranked = sorted(fit.item_coefficients.items(), key=lambda kv: kv[1], reverse=True)
        print(f"{target.label:<14} {fit.r2_cv:>7.3f}")
        for item_id, coef in ranked[: args.top]:
            item = catalog[item_id]
            print(f"{'':>14} {coef:+.3f}  {item.name:<26} {item.category:<9} "
                  f"{item.cost:>5}  (n={model.item_counts[item_id]})")

    weak = [t for t, f in model.fits.items() if f.r2_cv < 0.1]
    if weak and not args.skip_eval:
        print(f"\nNOTE: low cross-validated R^2 for {', '.join(weak)} — items explain")
        print("      little of these metrics at this sample size. Treat their")
        print("      coefficients as weak signal until more matches are added.")

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"\nSaved model to {MODEL_PATH}")


if __name__ == "__main__":
    main()
