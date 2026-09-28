#!/usr/bin/env python3
"""Export per-hero build meta (item affinity + archetypes) for the web app.

    python ml/export_hero_meta.py

Writes src/data/heroMeta.json. Two things travel across:

  * `affinity` — the display table: what this hero buys unusually often,
    with sample sizes and win rates so the UI can show the evidence.
  * `metaScore` — an optimizer input: smoothed log pick-rate lift for
    EVERY hero/item pair, z-normalized so it lands on the same scale as
    the learned performance coefficients and can be blended with them.

The score is smoothed (add-alpha) because items a hero never buys have a
lift of zero and an undefined log. Smoothing turns those into a finite
penalty whose size depends on how much *other* heroes buy the item —
being the only hero who skips a popular item is a stronger signal than
skipping something nobody takes.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from datetime import date
from pathlib import Path

from deadlock_ml.affinity import hero_item_affinity
from deadlock_ml.archetypes import find_archetypes
from deadlock_ml.catalog import load_heroes, load_items
from deadlock_ml.dataset import load_player_table

OUT_PATH = Path(__file__).resolve().parent.parent / "src" / "data" / "heroMeta.json"

SMOOTHING = 2.0
SCORE_CUTOFF = 0.05
# Levels seen fewer times than this are too thin to take a median from —
# games rarely end at low level, so those samples are early-surrender noise.
MIN_LEVEL_SAMPLES = 30
MAX_HERO_LEVEL = 36


def level_by_net_worth(df) -> list[dict]:
    """Souls at which a player typically reaches each hero level.

    Hero levels cost souls, but on a different accounting scale than item
    purchases: reaching level 33 wants 418,700 by the game's own
    required_gold curve, while players finish games near 40,000 net worth.
    The ratio between the two drifts from 5.9 to 10.7 across the level
    range, so the game curve can't just be rescaled — this uses observed
    medians instead, which is what "a player with this much gold" actually
    looks like.

    Below the reliable range the curve is interpolated down to (level 1,
    0 souls), since games almost never end early enough to measure it.
    """
    grouped = df.groupby("player_level")["net_worth"].agg(["size", "median"])
    reliable = [
        (int(level), float(row["median"]))
        for level, row in grouped.iterrows()
        if row["size"] >= MIN_LEVEL_SAMPLES and 1 < level <= MAX_HERO_LEVEL
    ]
    if not reliable:
        return []
    reliable.sort()

    lowest_level, lowest_souls = reliable[0]
    curve = {1: 0.0}
    for level in range(2, lowest_level):
        curve[level] = lowest_souls * (level - 1) / (lowest_level - 1)
    for level, souls in reliable:
        curve[level] = souls

    # Keep it monotonic so inverting it can't hand back a lower level for
    # more souls.
    out = []
    running = 0.0
    for level in sorted(curve):
        running = max(running, curve[level])
        out.append({"level": level, "souls": int(round(running))})
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-games", type=int, default=10,
                        help="minimum purchases before an item shows in the table")
    parser.add_argument("--top", type=int, default=12,
                        help="affinity rows to keep per hero")
    args = parser.parse_args()

    df = load_player_table()
    items = load_items()
    heroes = load_heroes()
    slug_of = {h.hero_id: h.class_name.removeprefix("hero_") for h in heroes.values()}

    # Global purchase counts, used as each item's "everyone else" baseline.
    total_rows = len(df)
    global_counts: Counter = Counter()
    for build in df["items"]:
        for item_id in set(build):
            global_counts[item_id] += 1

    raw_scores: dict[tuple[str, str], float] = {}
    affinity_out: dict[str, list] = {}
    archetypes_out: dict[str, dict] = {}

    for hero_id, hero in heroes.items():
        slug = slug_of[hero_id]
        mine = df[df["hero_id"] == hero_id]
        if len(mine) == 0:
            continue

        hero_counts: Counter = Counter()
        for build in mine["items"]:
            for item_id in set(build):
                hero_counts[item_id] += 1

        others_n = total_rows - len(mine)
        for item_id, item in items.items():
            other_count = global_counts.get(item_id, 0) - hero_counts.get(item_id, 0)
            hero_rate = (hero_counts.get(item_id, 0) + SMOOTHING) / (len(mine) + 2 * SMOOTHING)
            other_rate = (other_count + SMOOTHING) / (others_n + 2 * SMOOTHING)
            if other_rate <= 0:
                continue
            raw_scores[(slug, item.class_name)] = math.log(hero_rate / other_rate)

        table = hero_item_affinity(df, hero_id, min_games=args.min_games)
        if len(table):
            affinity_out[slug] = [
                {
                    "item": items[int(r.item_id)].class_name,
                    "name": r["name"],
                    "category": r["category"],
                    "cost": int(r["cost"]),
                    "games": int(r["games"]),
                    "pick": round(float(r["hero_pick_rate"]), 3),
                    "others": round(float(r["other_pick_rate"]), 3),
                    "lift": round(float(r["lift"]), 2) if r["lift"] != float("inf") else None,
                    "winRate": round(float(r["win_rate"]), 3),
                    "significant": bool(r["significant"]),
                }
                for _, r in table.head(args.top).iterrows()
            ]

        result = find_archetypes(df, hero_id)
        if result is not None and result.separated:
            archetypes_out[slug] = {
                "silhouette": round(result.silhouette, 3),
                "clusters": [
                    {
                        "size": c.size,
                        "share": round(c.size / result.hero_games, 3),
                        "winRate": round(c.win_rate, 3),
                        "signature": [
                            {"name": n, "inRate": round(i, 3), "outRate": round(o, 3)}
                            for n, i, o in c.signature[:5]
                        ],
                    }
                    for c in result.clusters
                ],
            }

    # Z-normalize so a meta weight of 1 is comparable to one standard
    # deviation of a learned performance objective.
    values = list(raw_scores.values())
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)) or 1.0

    meta_score: dict[str, dict[str, float]] = {}
    for (slug, item_class), value in raw_scores.items():
        z = (value - mean) / sd
        if abs(z) < SCORE_CUTOFF:
            continue
        meta_score.setdefault(slug, {})[item_class] = round(z, 3)

    payload = {
        "generated": date.today().isoformat(),
        "nMatches": int(df["match_id"].nunique()),
        "heroGames": {slug_of[h]: int(n) for h, n in
                      df.groupby("hero_id").size().items() if h in slug_of},
        "levelByNetWorth": level_by_net_worth(df),
        "affinity": affinity_out,
        "archetypes": archetypes_out,
        "metaScore": meta_score,
    }

    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    kb = OUT_PATH.stat().st_size / 1024
    n_scores = sum(len(v) for v in meta_score.values())
    print(f"Wrote {OUT_PATH} ({kb:.0f} KB)")
    print(f"  affinity tables: {len(affinity_out)} heroes")
    print(f"  archetypes (well-separated only): {len(archetypes_out)} heroes")
    print(f"  meta scores: {n_scores:,} hero/item pairs")
    print(f"  level curve: {len(payload['levelByNetWorth'])} levels")


if __name__ == "__main__":
    main()
