"""Do a hero's players split into distinct builds, or one blurry consensus?

Average pick rates describe a hero's *typical* build, which is misleading
if the playerbase actually runs two different ones — a gun build and a
spirit build would average into a muddle that nobody plays.

Builds are clustered as unit-normalized item vectors, so distance reflects
composition rather than how many items got bought. Without that, the
strongest split is always "long rich game" versus "short poor game", which
says nothing about build intent.

Silhouette scores on sparse binary data like this run low even when the
structure is real, so the number is reported rather than thresholded, and
`separated` is only set when clusters are distinct enough to be worth
describing separately.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from .catalog import load_items


@dataclass
class BuildCluster:
    label: int
    size: int
    win_rate: float
    mean_net_worth: float
    mean_items: float
    # (name, rate in cluster, rate elsewhere) for the defining items
    signature: list[tuple[str, float, float]]


@dataclass
class ArchetypeResult:
    hero_games: int
    k: int
    silhouette: float
    separated: bool
    clusters: list[BuildCluster]


def find_archetypes(
    df: pd.DataFrame,
    hero_id: int,
    min_pick_rate: float = 0.05,
    k_range: tuple[int, ...] = (2, 3, 4),
    signature_n: int = 6,
    random_state: int = 0,
) -> ArchetypeResult | None:
    catalog = load_items()
    mine = df[df["hero_id"] == hero_id].reset_index(drop=True)
    if len(mine) < 40:
        return None

    counts: Counter = Counter()
    for build in mine["items"]:
        for item_id in set(build):
            counts[item_id] += 1

    # Only items this hero buys with some regularity; the long tail is noise
    # and would dominate the distance metric.
    item_ids = [
        i for i, c in counts.items()
        if c / len(mine) >= min_pick_rate and i in catalog
    ]
    if len(item_ids) < 5:
        return None

    index = {item_id: i for i, item_id in enumerate(item_ids)}
    X = np.zeros((len(mine), len(item_ids)), dtype=np.float64)
    for row, build in enumerate(mine["items"]):
        for item_id in set(build):
            j = index.get(item_id)
            if j is not None:
                X[row, j] = 1.0

    # Unit-normalize so clustering compares composition, not build size.
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    Xn = X / norms

    best = None
    for k in k_range:
        if k >= len(mine):
            continue
        model = KMeans(n_clusters=k, n_init=10, random_state=random_state)
        labels = model.fit_predict(Xn)
        if len(set(labels)) < 2:
            continue
        score = silhouette_score(Xn, labels)
        if best is None or score > best[0]:
            best = (score, k, labels)

    if best is None:
        return None
    score, k, labels = best

    clusters = []
    for label in range(k):
        mask = labels == label
        if not mask.any():
            continue
        in_rate = X[mask].mean(axis=0)
        out_rate = X[~mask].mean(axis=0) if (~mask).any() else np.zeros_like(in_rate)
        order = np.argsort(in_rate - out_rate)[::-1][:signature_n]
        signature = [
            (catalog[item_ids[j]].name, float(in_rate[j]), float(out_rate[j]))
            for j in order
            if in_rate[j] > 0
        ]
        subset = mine[mask]
        clusters.append(BuildCluster(
            label=label,
            size=int(mask.sum()),
            win_rate=float(subset["won"].mean()),
            mean_net_worth=float(subset["net_worth"].mean()),
            mean_items=float(subset["items"].apply(len).mean()),
            signature=signature,
        ))

    clusters.sort(key=lambda c: c.size, reverse=True)
    return ArchetypeResult(
        hero_games=len(mine),
        k=k,
        silhouette=float(score),
        separated=score > 0.10,
        clusters=clusters,
    )
