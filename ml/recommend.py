#!/usr/bin/env python3
"""Recommend a build for a hero, budget, and performance objective.

    python ml/recommend.py --hero Infernus --budget 20000
    python ml/recommend.py --hero Abrams --weights "max_health=1,mitigation=0.6"
    python ml/recommend.py --hero Haze --weights "dps=1,weapon_power=0.5" --explain

Objectives are end-of-match performance metrics, not win rate. Weights are
in standard deviations of each metric, so mixing them is meaningful.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib

from deadlock_ml.catalog import hero_by_name, load_heroes
from deadlock_ml.optimizer import optimize
from deadlock_ml.targets import DEFAULT_WEIGHTS, TARGETS, parse_weights

MODEL_PATH = Path(__file__).resolve().parent / "models" / "performance_model.joblib"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hero", required=True, help="hero name, e.g. Infernus")
    parser.add_argument("--budget", type=int, default=20000, help="souls to spend")
    parser.add_argument("--slots", type=int, default=12, help="item slots available")
    parser.add_argument("--weights", default=None,
                        help='objective spec, e.g. "dps=1,max_health=0.5"')
    parser.add_argument("--pooled", action="store_true",
                        help="ignore the hero-specific adjustment")
    parser.add_argument("--explain", action="store_true",
                        help="break each item's value down by objective")
    parser.add_argument("--list-targets", action="store_true")
    args = parser.parse_args()

    if args.list_targets:
        for target in TARGETS.values():
            print(f"  {target.key:<14} {target.description}")
        return

    hero = hero_by_name(args.hero)
    if hero is None:
        known = ", ".join(sorted(h.name for h in load_heroes().values()))
        raise SystemExit(f"Unknown hero {args.hero!r}. Known heroes: {known}")

    weights = parse_weights(args.weights) if args.weights else dict(DEFAULT_WEIGHTS)

    if not MODEL_PATH.exists():
        raise SystemExit("No trained model found. Run: python ml/train.py")
    model = joblib.load(MODEL_PATH)

    hero_id = None if args.pooled else hero.hero_id
    values = model.item_values(weights, hero_id=hero_id)
    build = optimize(values, budget=args.budget, max_slots=args.slots)

    objective = ", ".join(f"{TARGETS[k].label} x{v:g}" for k, v in weights.items())
    print(f"\n{hero.name} — budget {args.budget:,} souls, {args.slots} slots")
    print(f"Objective: {objective}")
    fit_quality = ", ".join(f"{TARGETS[k].label} R^2 {model.fits[k].r2_cv:.2f}" for k in weights)
    print(f"Model fit: {fit_quality}")
    if args.pooled:
        print("Values: pooled across all heroes\n")
    else:
        games = model.hero_game_counts.get(hero.hero_id, 0)
        print(f"Values: pooled + {hero.name} residual adjustment ({games} games)\n")

    if not build.items:
        print("No items scored positively for this objective within budget.")
        return

    for category in ("weapon", "vitality", "spirit"):
        items = build.by_category.get(category, [])
        if not items:
            continue
        spend = sum(i.cost for i in items)
        print(f"{category.upper():<9} ({len(items)} items, {spend:,} souls)")
        for item in items:
            value = values.get(item.item_id, 0.0)
            n = model.item_counts.get(item.item_id, 0)
            print(f"   T{item.tier} {item.name:<26} {item.cost:>5}  "
                  f"value {value:+.3f}  (seen {n}x)")
            if args.explain:
                parts = model.contributions(item.item_id, weights, hero_id=hero_id)
                detail = "  ".join(
                    f"{TARGETS[k].label} {v:+.3f}" for k, v in parts.items()
                )
                print(f"        {detail}")
        print()

    print(f"Total: {len(build.items)} items, {build.total_cost:,} souls "
          f"({args.budget - build.total_cost:,} unspent)")


if __name__ == "__main__":
    main()
