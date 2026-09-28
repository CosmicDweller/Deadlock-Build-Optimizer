#!/usr/bin/env python3
"""Export per-hero build meta (item affinity + archetypes) for the web app.

    python ml/export_hero_meta.py

Writes src/data/heroMeta.json. Two things travel across:

  * `affinity` — the display table: what this hero buys unusually often,
    with sample sizes and win rates so the UI can show the evidence.
  * `metaScore` — an optimizer input: how often this hero actually builds
    each item, as the log-odds of its smoothed pick rate, z-normalized so
    it lands on the same scale as the learned performance coefficients.

`metaScore` deliberately measures the hero's OWN pick rate rather than its
lift over other heroes, even though the affinity table above reports lift.
The two answer different questions and only one belongs in the optimizer.

Lift asks "what is distinctive about this hero", which is the right thing
to display. It is the wrong thing to build with: an item Wraith takes 7% of
the time and nobody else touches outscores one Wraith takes 84% of the
time, which is not what "follow the meta" should mean. Worse, add-alpha
smoothing gives never-bought items a spuriously POSITIVE lift, because a
single hero has far fewer games than the pooled rest, so the smoothed
numerator exceeds the smoothed denominator. Under lift, every hero's
highest-scoring items were the tier 5s that nobody buys at all.

Log-odds of the hero's own pick rate has neither problem: commonly built
items score high, never-built ones land strongly negative.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
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
# Minute marks to sample the spend curve at. Beyond ~36 the sample thins
# out fast, because that is roughly when games end.
CURVE_MINUTES = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36]
MIN_CURVE_SAMPLES = 2000
# Minute marks the progression view plans around: laning, mid, late.
PHASE_MINUTES = [10, 22, 36]
MIN_PHASE_SAMPLES = 100


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


def soul_curve(matches_path=None) -> list[dict]:
    """Median cumulative item spend, and item count, by minute.

    Drives the phase budgets in the progression view. Taken from purchase
    timings in the raw match log, which the cached player table throws
    away, so this re-streams the dump.

    Only purchases still held at the end are counted, and each item once —
    the same basis as the final build, so a phase budget and the build it
    has to pay for are measured the same way. Entries are sorted by
    game_time_s rather than trusted in array order, because roughly 8% of
    players' item arrays are not stored in time order.
    """
    from deadlock_ml.catalog import load_items as _load_items
    from deadlock_ml.dataset import iter_matches

    shop = _load_items()
    samples: dict[int, list[tuple[int, int]]] = {m: [] for m in CURVE_MINUTES}
    for match in iter_matches() if matches_path is None else iter_matches(matches_path):
        if match.get("not_scored"):
            continue
        duration = match.get("duration_s", 0)
        for player in match["players"]:
            if player.get("abandon_match_time_s"):
                continue
            entries = [
                e for e in (player.get("items") or [])
                if e["item_id"] in shop and not e.get("sold_time_s")
            ]
            seen: set[int] = set()
            timeline: list[tuple[int, int]] = []
            for entry in sorted(entries, key=lambda e: e["game_time_s"]):
                if entry["item_id"] in seen:
                    continue
                seen.add(entry["item_id"])
                timeline.append((entry["game_time_s"], shop[entry["item_id"]].cost))
            spend = 0
            index = 0
            for minute in CURVE_MINUTES:
                if minute * 60 > duration:
                    break
                while index < len(timeline) and timeline[index][0] <= minute * 60:
                    spend += timeline[index][1]
                    index += 1
                samples[minute].append((spend, index))

    curve = []
    for minute in CURVE_MINUTES:
        rows = samples[minute]
        if len(rows) < MIN_CURVE_SAMPLES:
            continue
        spends = sorted(r[0] for r in rows)
        counts = sorted(r[1] for r in rows)
        mid = len(rows) // 2
        curve.append({
            "minute": minute,
            "souls": int(spends[mid]),
            "items": int(counts[mid]),
            "samples": len(rows),
        })
    return curve


def phase_pick_rates(matches_path=None) -> dict:
    """Per-hero item pick rates AT each phase minute, as z-scored log-odds.

    The endgame model cannot see lane value: it scores items by what they
    produced over a whole match, so asking it for a 10-minute build just
    returns the cheap corner of the late build. Measuring what players
    actually hold at minute 10 fixes that directly — Wraith holds Rapid
    Rounds in 49% of games at minute 10 and essentially never at 22, having
    upgraded it into Swift Striker.

    An item counts as held at minute M if it was bought by then and not yet
    sold, so upgrade components correctly drop out once consumed. Same
    log-odds transform and z-normalization as the endgame meta score, so the
    two are interchangeable in the blend.
    """
    from deadlock_ml.catalog import load_items as _load_items, load_heroes as _load_heroes
    from deadlock_ml.dataset import iter_matches

    shop = _load_items()
    heroes = _load_heroes()
    slug_of = {h.hero_id: h.class_name.removeprefix("hero_") for h in heroes.values()}

    held: dict = {m: defaultdict(Counter) for m in PHASE_MINUTES}
    seen_counts: dict = {m: Counter() for m in PHASE_MINUTES}

    for match in iter_matches() if matches_path is None else iter_matches(matches_path):
        if match.get("not_scored"):
            continue
        duration = match.get("duration_s", 0)
        for player in match["players"]:
            if player.get("abandon_match_time_s"):
                continue
            hero_id = player["hero_id"]
            if hero_id not in slug_of:
                continue
            entries = [e for e in (player.get("items") or []) if e["item_id"] in shop]
            for minute in PHASE_MINUTES:
                if minute * 60 > duration:
                    continue
                seen_counts[minute][hero_id] += 1
                owned = {
                    e["item_id"] for e in entries
                    if e["game_time_s"] <= minute * 60
                    and (not e.get("sold_time_s") or e["sold_time_s"] > minute * 60)
                }
                for item_id in owned:
                    held[minute][hero_id][item_id] += 1

    raw: dict[tuple[int, str, str], float] = {}
    for minute in PHASE_MINUTES:
        for hero_id, games in seen_counts[minute].items():
            if games < MIN_PHASE_SAMPLES:
                continue
            for item_id, item in shop.items():
                rate = (held[minute][hero_id].get(item_id, 0) + SMOOTHING) / (games + 2 * SMOOTHING)
                raw[(minute, slug_of[hero_id], item.class_name)] = math.log(rate / (1 - rate))

    if not raw:
        return {}
    values = list(raw.values())
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)) or 1.0

    out: dict = {}
    for (minute, slug, item_class), value in raw.items():
        z = (value - mean) / sd
        if abs(z) < SCORE_CUTOFF:
            continue
        out.setdefault(str(minute), {}).setdefault(slug, {})[item_class] = round(z, 3)
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

        for item_id, item in items.items():
            hero_rate = (hero_counts.get(item_id, 0) + SMOOTHING) / (len(mine) + 2 * SMOOTHING)
            # Log-odds of this hero's own pick rate. Smoothing only keeps
            # the log finite for items at 0% or 100%.
            raw_scores[(slug, item.class_name)] = math.log(hero_rate / (1 - hero_rate))

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
        "soulCurve": soul_curve(),
        "phaseMeta": phase_pick_rates(),
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
    print(f"  soul curve: {len(payload['soulCurve'])} minute marks")
    n_phase = sum(len(i) for m in payload["phaseMeta"].values() for i in m.values())
    print(f"  phase meta: {n_phase:,} entries over {len(payload['phaseMeta'])} phases")


if __name__ == "__main__":
    main()
