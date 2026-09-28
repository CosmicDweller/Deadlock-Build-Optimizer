"""Pick the build that maximizes learned item value within a soul budget.

Constraint model comes from what the match data actually shows: builds cap
out at 12 items total, with no meaningful per-category cap (single-category
counts of 9-10 show up in real games). Costs are bucketed at 100 souls,
which every item cost divides into evenly except the 9999-soul tier-5s;
those round UP, so a suggested build is never one the budget can't cover.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .catalog import ShopItem, load_items

BUCKET = 100
MAX_SLOTS = 12


@dataclass
class OptimizedBuild:
    items: list[ShopItem]
    total_cost: int
    total_value: float

    @property
    def by_category(self) -> dict[str, list[ShopItem]]:
        grouped: dict[str, list[ShopItem]] = {}
        for item in self.items:
            grouped.setdefault(item.category, []).append(item)
        return grouped


def optimize(
    item_values: dict[int, float],
    budget: int,
    max_slots: int = MAX_SLOTS,
    candidates: list[ShopItem] | None = None,
    min_value: float = 0.0,
) -> OptimizedBuild:
    """0/1 knapsack with a cardinality cap, maximizing summed item value.

    `min_value` drops items whose learned value is at or below the cutoff —
    with 0.0 that means the optimizer only ever suggests items the model
    scored positively, so leftover budget is left unspent rather than
    padded with items the data says hurt.
    """
    catalog = load_items()
    pool = candidates if candidates is not None else list(catalog.values())
    pool = [it for it in pool if item_values.get(it.item_id, 0.0) > min_value]

    n_buckets = budget // BUCKET
    if not pool or n_buckets <= 0 or max_slots <= 0:
        return OptimizedBuild(items=[], total_cost=0, total_value=0.0)

    costs = [math.ceil(it.cost / BUCKET) for it in pool]
    values = [item_values[it.item_id] for it in pool]

    neg = -np.inf
    dp = np.full((max_slots + 1, n_buckets + 1), neg, dtype=np.float64)
    dp[0, 0] = 0.0
    took: list[np.ndarray] = []

    for cost, value in zip(costs, values):
        prev = dp
        cur = prev.copy()
        if cost <= n_buckets:
            for k in range(1, max_slots + 1):
                shifted = prev[k - 1, : n_buckets + 1 - cost] + value
                np.maximum(cur[k, cost:], shifted, out=cur[k, cost:])
        took.append(cur != prev)
        dp = cur

    # Best reachable (slots, spend) cell, then walk the choices back out.
    flat = int(np.nanargmax(np.where(np.isfinite(dp), dp, neg)))
    best_k, best_c = divmod(flat, n_buckets + 1)
    best_value = dp[best_k, best_c]
    if not np.isfinite(best_value) or best_value <= 0:
        return OptimizedBuild(items=[], total_cost=0, total_value=0.0)

    chosen: list[ShopItem] = []
    k, c = best_k, best_c
    for i in range(len(pool) - 1, -1, -1):
        if k == 0:
            break
        if took[i][k, c]:
            chosen.append(pool[i])
            k -= 1
            c -= costs[i]

    chosen.sort(key=lambda it: (it.category, -it.cost))
    return OptimizedBuild(
        items=chosen,
        total_cost=sum(it.cost for it in chosen),
        total_value=float(best_value),
    )
