#!/usr/bin/env python3
"""What's distinctive about one hero's builds, from several angles.

    python ml/hero_report.py --hero Abrams
    python ml/hero_report.py --hero Abrams --archetypes
    python ml/hero_report.py --hero Abrams --item "Mystic Expansion"

Four views, because each fails differently:

  * Item affinity — what this hero buys far more than every other hero.
    By far the strongest signal here: outcome-independent, so no
    snowballing confounds, and effect sizes run 5-15x rather than a few
    percent. It measures player consensus, not physics, so it catches kit
    synergies nothing else can — and will equally confidently report a
    playerbase agreeing on a bad item.
  * Build archetypes — whether that consensus is actually one build or
    several, since averaging a gun build and a spirit build produces a
    blend nobody runs.
  * Win-rate correlations — noisy and outcome-driven, but the only view
    that speaks to whether a choice works rather than whether it's popular.
  * Performance residuals — what the hero gets out of an item beyond the
    pooled model, economy already controlled for. Steady, but blind to
    anything the target metrics don't measure.

An item strong in several of these is worth believing.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib

from deadlock_ml.affinity import co_purchase, hero_item_affinity
from deadlock_ml.archetypes import find_archetypes
from deadlock_ml.catalog import hero_by_name, load_heroes, load_items
from deadlock_ml.dataset import load_player_table
from deadlock_ml.targets import TARGETS
from deadlock_ml.winrates import item_win_rates

MODEL_PATH = Path(__file__).resolve().parent / "models" / "performance_model.joblib"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hero", required=True)
    parser.add_argument("--min-games", type=int, default=20,
                        help="minimum times the hero bought an item to report it")
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--item", default=None,
                        help="drill into one item by name instead")
    parser.add_argument("--archetypes", action="store_true",
                        help="cluster this hero's builds into distinct archetypes")
    args = parser.parse_args()

    hero = hero_by_name(args.hero)
    if hero is None:
        known = ", ".join(sorted(h.name for h in load_heroes().values()))
        raise SystemExit(f"Unknown hero {args.hero!r}. Known heroes: {known}")

    if not MODEL_PATH.exists():
        raise SystemExit("No trained model found. Run: python ml/train.py")
    model = joblib.load(MODEL_PATH)

    df = load_player_table()
    hero_rows = df[df["hero_id"] == hero.hero_id]
    baseline = hero_rows["won"].mean() if len(hero_rows) else 0.0

    print(f"\n{hero.name} — {len(hero_rows)} games in dataset, "
          f"{baseline:.1%} baseline win rate")

    catalog = load_items()
    by_name = {it.name.lower(): it for it in catalog.values()}

    if args.item:
        item = by_name.get(args.item.lower())
        if item is None:
            raise SystemExit(f"Unknown item {args.item!r}")
        bought = hero_rows[hero_rows["items"].apply(lambda b: item.item_id in b)]
        print(f"\n{item.name} ({item.category} T{item.tier}, {item.cost} souls)")
        print(f"  Bought in {len(bought)}/{len(hero_rows)} {hero.name} games "
              f"({len(bought) / max(len(hero_rows), 1):.0%}), "
              f"{model.item_counts.get(item.item_id, 0)} times overall")
        if len(bought):
            print(f"  Win rate with it: {bought['won'].mean():.1%} "
                  f"vs {baseline:.1%} baseline")
        print(f"\n  {'objective':<16} {'pooled':>8} {hero.name[:10]:>10} {'total':>8}")
        for key, target in TARGETS.items():
            fit = model.fits[key]
            pooled = fit.item_coefficients.get(item.item_id, 0.0)
            adj = fit.hero_adjustments.get((hero.hero_id, item.item_id), 0.0)
            print(f"  {target.label:<16} {pooled:>+8.3f} {adj:>+10.3f} {pooled + adj:>+8.3f}")

        combos = co_purchase(df, hero.hero_id, item.item_id)
        if len(combos):
            print(f"\n  Bought alongside it (vs {hero.name} games without it):")
            for _, r in combos.head(8).iterrows():
                lift = "inf" if r["lift"] == float("inf") else f"{r['lift']:.1f}x"
                print(f"    {r['rate_with_anchor']:>4.0%} vs {r['rate_without']:>4.0%} "
                      f"({lift:>5})  n={int(r['games']):<4} {r['name']}")
        else:
            print(f"\n  Too few {hero.name} games with it to show co-purchases.")
        return

    affinity = hero_item_affinity(df, hero.hero_id, min_games=10)
    print(f"\n=== Item affinity — what {hero.name} buys unlike anyone else ===")
    if len(affinity) == 0:
        print(f"  No item reaches 10 games on {hero.name}.")
    else:
        print(f"  {'lift':>6} {'pick':>6} {'others':>7} {'n':>5} {'win%':>6}  item")
        for _, r in affinity.head(args.top).iterrows():
            lift = "inf" if r["lift"] == float("inf") else f"{r['lift']:.1f}x"
            flag = "*" if r["significant"] else " "
            print(f"  {lift:>6} {r['hero_pick_rate']:>6.0%} {r['other_pick_rate']:>7.0%} "
                  f"{int(r['games']):>5} {r['win_rate']:>6.0%} {flag} {r['name']} "
                  f"({r['category']})")
        print(f"  * = pick rate differs from other heroes beyond chance (|z| > 3)")

    if args.archetypes:
        print(f"\n=== Build archetypes ===")
        result = find_archetypes(df, hero.hero_id)
        if result is None:
            print(f"  Not enough {hero.name} games to cluster.")
        else:
            verdict = ("clusters are reasonably distinct" if result.separated
                       else "clusters overlap heavily — likely one build with variations")
            print(f"  k={result.k}, silhouette {result.silhouette:.3f} — {verdict}")
            for cluster in result.clusters:
                share = cluster.size / result.hero_games
                print(f"\n  Cluster {cluster.label}: {cluster.size} games ({share:.0%}), "
                      f"{cluster.win_rate:.0%} win, {cluster.mean_items:.1f} items, "
                      f"{cluster.mean_net_worth:,.0f} net worth")
                for name, in_rate, out_rate in cluster.signature:
                    print(f"     {in_rate:>4.0%} vs {out_rate:>4.0%}  {name}")

    rates = item_win_rates(df, hero_id=hero.hero_id, min_games=args.min_games)
    print(f"\n=== Win-rate correlations (min {args.min_games} games with the item) ===")
    if len(rates) == 0:
        print(f"  No item reaches {args.min_games} games on {hero.name}.")
    else:
        sig = rates[rates["significant"]]
        print(f"  {len(rates)} items qualify; {len(sig)} differ from baseline "
              f"beyond their 95% interval.")
        print(f"\n  {'win%':>6} {'95% CI':>13} {'n':>5}  item")
        for _, r in rates.head(args.top).iterrows():
            flag = " *" if r["significant"] else "  "
            print(f"  {r['win_rate']:>5.0%} {r['ci_low']:>5.0%}-{r['ci_high']:<6.0%} "
                  f"{int(r['games']):>5}{flag} {r['name']}")
        if len(sig) == 0:
            print("\n  Nothing clears the baseline conclusively — expected at this")
            print("  sample size. Treat the ordering as a hint, not a finding.")

    print(f"\n=== Performance residuals (what {hero.name} gets beyond the pooled model) ===")
    for key, target in TARGETS.items():
        fit = model.fits[key]
        hero_adj = [
            (item_id, value)
            for (h, item_id), value in fit.hero_adjustments.items()
            if h == hero.hero_id
        ]
        if not hero_adj:
            continue
        hero_adj.sort(key=lambda kv: kv[1], reverse=True)
        best = [(i, v) for i, v in hero_adj[:3] if v > 0.02]
        if not best:
            continue
        names = ", ".join(
            f"{catalog[i].name} {v:+.2f}" for i, v in best if i in catalog
        )
        print(f"  {target.label:<16} {names}")

    print("\nWin-rate ordering is by interval lower bound, so thin samples sink.")
    print("Testing ~140 items against one baseline will produce a few false")
    print("positives regardless — corroborate against the residuals above.")


if __name__ == "__main__":
    main()
