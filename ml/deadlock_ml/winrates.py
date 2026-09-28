"""Per-hero item win-rate correlations.

This is a *discovery* tool, deliberately kept out of the optimizer's
objective. Match outcome is dominated by teammates, matchups and who
snowballed first, so it makes a poor thing to optimize directly — but it's
still the only signal that can catch value no performance metric encodes,
like an item that merely enables a hero's kit.

Two statistical hazards get surfaced rather than hidden:

*Small samples.* A hero appears in only a few hundred games here, and any
one item in a fraction of those. Wilson intervals are reported alongside
every rate so a 75% win rate on n=12 reads as the coin-flip it is.

*Multiple comparisons.* Testing ~140 items against one hero's baseline will
throw up "significant" results by chance alone. Ranking is therefore by the
interval's lower bound, not the point estimate, which automatically buries
thin samples, and `significant` is flagged only when the whole interval
clears the baseline.
"""
from __future__ import annotations

import math

import pandas as pd

from .catalog import load_items


def wilson_interval(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = wins / n
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    margin = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))


def item_win_rates(
    df: pd.DataFrame, hero_id: int | None = None, min_games: int = 20
) -> pd.DataFrame:
    """Win rate per item for one hero (or pooled), against that baseline."""
    catalog = load_items()
    subset = df if hero_id is None else df[df["hero_id"] == hero_id]
    if len(subset) == 0:
        return pd.DataFrame()
    baseline = subset["won"].mean()

    tally: dict[int, list[int]] = {}
    for build, won in zip(subset["items"], subset["won"]):
        for item_id in build:
            entry = tally.setdefault(item_id, [0, 0])
            entry[0] += int(won)
            entry[1] += 1

    rows = []
    for item_id, (wins, games) in tally.items():
        item = catalog.get(item_id)
        if item is None or games < min_games:
            continue
        low, high = wilson_interval(wins, games)
        rows.append({
            "item_id": item_id,
            "name": item.name,
            "category": item.category,
            "tier": item.tier,
            "cost": item.cost,
            "games": games,
            "pick_rate": games / len(subset),
            "win_rate": wins / games,
            "ci_low": low,
            "ci_high": high,
            "vs_baseline": wins / games - baseline,
            # Only counts when the entire interval sits off the baseline.
            "significant": low > baseline or high < baseline,
        })

    out = pd.DataFrame(rows)
    if len(out) == 0:
        return out
    return out.sort_values("ci_low", ascending=False).reset_index(drop=True)
