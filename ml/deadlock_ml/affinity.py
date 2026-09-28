"""Which items a specific hero buys far more than everyone else.

Pick rate turns out to be the strongest per-hero signal in this dataset by
a wide margin. It doesn't depend on match outcome, so none of the
snowballing confounds apply, and the effect sizes are enormous: Abrams
takes Melee Charge in 76% of games against a 5% baseline. Win rate on the
same sample moves by ten points with intervals half that wide, and
performance residuals move by a tenth of a standard deviation.

What it measures is collective player judgment rather than any physical
quantity — which is exactly why it catches what the stat and performance
models miss. Melee Charge is not on Abrams for its passive stats; it's
there because it works with his kit, and three hundred players worked that
out. The flip side is that popularity is not correctness: a whole
playerbase can agree on a bad item, and this will report that agreement
just as confidently.

Lift compares a hero against every *other* hero rather than the pooled
average, so a hero that dominates an item's usage can't inflate its own
baseline.
"""
from __future__ import annotations

import math
from collections import Counter

import pandas as pd

from .catalog import load_items


def _two_proportion_z(x1: int, n1: int, x2: int, n2: int) -> float:
    """Z statistic for a difference in two independent proportions."""
    if n1 == 0 or n2 == 0:
        return 0.0
    p_pool = (x1 + x2) / (n1 + n2)
    denom = math.sqrt(p_pool * (1 - p_pool) * (1 / n1 + 1 / n2))
    if denom == 0:
        return 0.0
    return (x1 / n1 - x2 / n2) / denom


def hero_item_affinity(
    df: pd.DataFrame, hero_id: int, min_games: int = 10
) -> pd.DataFrame:
    """Items this hero buys disproportionately often, vs all other heroes."""
    catalog = load_items()
    mine = df[df["hero_id"] == hero_id]
    others = df[df["hero_id"] != hero_id]
    if len(mine) == 0:
        return pd.DataFrame()

    def tally(frame: pd.DataFrame) -> Counter:
        counts: Counter = Counter()
        for build in frame["items"]:
            for item_id in set(build):
                counts[item_id] += 1
        return counts

    mine_counts = tally(mine)
    other_counts = tally(others)

    rows = []
    for item_id, count in mine_counts.items():
        item = catalog.get(item_id)
        if item is None or count < min_games:
            continue
        hero_rate = count / len(mine)
        other_rate = other_counts.get(item_id, 0) / len(others) if len(others) else 0.0
        z = _two_proportion_z(count, len(mine), other_counts.get(item_id, 0), len(others))

        with_item = mine[mine["items"].apply(lambda b: item_id in b)]
        rows.append({
            "item_id": item_id,
            "name": item.name,
            "category": item.category,
            "tier": item.tier,
            "cost": item.cost,
            "games": count,
            "hero_pick_rate": hero_rate,
            "other_pick_rate": other_rate,
            "lift": hero_rate / other_rate if other_rate else float("inf"),
            "z": z,
            # |z| > 3 keeps false positives rare even testing ~140 items.
            "significant": abs(z) > 3,
            "win_rate": with_item["won"].mean() if len(with_item) else 0.0,
        })

    out = pd.DataFrame(rows)
    if len(out) == 0:
        return out
    return out.sort_values("lift", ascending=False).reset_index(drop=True)


def co_purchase(
    df: pd.DataFrame, hero_id: int, anchor_item_id: int, min_games: int = 5
) -> pd.DataFrame:
    """What else this hero buys when they've bought a given item.

    Answers questions of the form "when Abrams goes spirit, what does the
    rest of that build look like" without needing to define the archetype
    up front.
    """
    catalog = load_items()
    mine = df[df["hero_id"] == hero_id]
    with_anchor = mine[mine["items"].apply(lambda b: anchor_item_id in b)]
    without = mine[mine["items"].apply(lambda b: anchor_item_id not in b)]
    if len(with_anchor) == 0:
        return pd.DataFrame()

    rows = []
    counts: Counter = Counter()
    for build in with_anchor["items"]:
        for item_id in set(build):
            counts[item_id] += 1

    base_counts: Counter = Counter()
    for build in without["items"]:
        for item_id in set(build):
            base_counts[item_id] += 1

    for item_id, count in counts.items():
        if item_id == anchor_item_id or count < min_games:
            continue
        item = catalog.get(item_id)
        if item is None:
            continue
        rate = count / len(with_anchor)
        base_rate = base_counts.get(item_id, 0) / len(without) if len(without) else 0.0
        rows.append({
            "name": item.name,
            "category": item.category,
            "cost": item.cost,
            "games": count,
            "rate_with_anchor": rate,
            "rate_without": base_rate,
            "lift": rate / base_rate if base_rate else float("inf"),
        })

    out = pd.DataFrame(rows)
    if len(out) == 0:
        return out
    return out.sort_values("lift", ascending=False).reset_index(drop=True)
