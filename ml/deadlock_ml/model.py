"""Learn what each item contributes to each performance metric.

One ridge regression per target (DPS, weapon power, max health, ...), of
the form `metric ~ items + hero + controls`. The item coefficients are the
payload: "holding budget and hero fixed, owning this item goes with this
much more of that metric."

Getting coefficients that mean anything needs care about two confounds:

1. *Economy.* Players who snowball buy more and pricier items AND put up
   bigger numbers. `net_worth` is therefore a control, which turns every
   coefficient into a budget-conditional statement — exactly the question a
   build optimizer asks ("for the souls I have, what should I buy").
2. *Budget composition.* Controlling for net worth alone is not enough: at
   a fixed net worth, owning a 6400-soul item mechanically means owning
   fewer items. The item indicators then soak up "how many items did you
   buy" and collapse into "cheap good, expensive bad". `n_items` and
   `total_item_cost` pin that down separately.

Features are also demeaned within each match, which removes every
match-level confound at once — game length, lobby skill, how farm-heavy the
game was. CV folds are grouped by match_id so the 12 players of one match
never straddle a split.

Targets are standardized before fitting, so a coefficient reads as "standard
deviations of this metric per item" and blending several objectives together
is meaningful despite their wildly different units (HP in the thousands,
weapon power in the tens).

Stat targets like max_health are near-deterministic functions of the items
owned, so their R^2 should come out very high — that is the pipeline
recovering real game math and is a useful sanity check. Damage targets are
much noisier because they also depend on the player.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold, cross_val_score
from sklearn.preprocessing import StandardScaler

from .catalog import load_items
from .targets import TARGETS, add_targets

CONTROL_COLUMNS = [
    "net_worth",
    "duration_s",
    "average_badge",
    "player_level",
    "n_items",
    "total_item_cost",
]

# Half-weight point for per-hero adjustments: a (hero, item) pair needs this
# many observations before its own signal counts as much as the pooled fit.
HERO_SHRINKAGE_N = 50


@dataclass
class TargetFit:
    """Per-item coefficients for one objective metric, in target SDs."""
    target: str
    item_coefficients: dict[int, float]
    target_std: float
    target_mean: float
    r2_cv: float = 0.0
    # (hero_id, item_id) -> residual-based nudge, in target SDs
    hero_adjustments: dict[tuple[int, int], float] = field(default_factory=dict)


@dataclass
class PerformanceModel:
    fits: dict[str, TargetFit]
    item_counts: dict[int, int]
    hero_game_counts: dict[int, int]
    n_rows: int
    n_matches: int

    def item_values(
        self,
        weights: dict[str, float],
        hero_id: int | None = None,
    ) -> dict[int, float]:
        """Blend per-target item coefficients into one value per item."""
        blended: dict[int, float] = {}
        for target, weight in weights.items():
            fit = self.fits.get(target)
            if fit is None or weight == 0:
                continue
            for item_id, coef in fit.item_coefficients.items():
                value = coef
                if hero_id is not None:
                    value += fit.hero_adjustments.get((hero_id, item_id), 0.0)
                blended[item_id] = blended.get(item_id, 0.0) + weight * value
        return blended

    def contributions(
        self, item_id: int, weights: dict[str, float], hero_id: int | None = None
    ) -> dict[str, float]:
        """Per-target breakdown of one item's blended value."""
        out: dict[str, float] = {}
        for target, weight in weights.items():
            fit = self.fits.get(target)
            if fit is None or weight == 0:
                continue
            value = fit.item_coefficients.get(item_id, 0.0)
            if hero_id is not None:
                value += fit.hero_adjustments.get((hero_id, item_id), 0.0)
            out[target] = weight * value
        return out


def add_build_controls(df: pd.DataFrame) -> pd.DataFrame:
    catalog = load_items()
    df = df.copy()
    df["n_items"] = df["items"].apply(len)
    df["total_item_cost"] = df["items"].apply(
        lambda build: sum(catalog[i].cost for i in build if i in catalog)
    )
    return df


def demean_by_match(X: np.ndarray, match_ids: np.ndarray) -> np.ndarray:
    """Subtract each match's mean from every column (within transformation)."""
    order = np.argsort(match_ids, kind="stable")
    inverse = np.empty_like(order)
    inverse[order] = np.arange(len(order))

    sorted_X = X[order]
    sorted_ids = match_ids[order]
    starts = np.flatnonzero(np.r_[True, sorted_ids[1:] != sorted_ids[:-1]])
    sums = np.add.reduceat(sorted_X, starts, axis=0)
    sizes = np.diff(np.r_[starts, len(sorted_ids)])
    means = sums / sizes[:, None]
    centered = sorted_X - np.repeat(means, sizes, axis=0)
    return centered[inverse]


def build_matrix(
    df: pd.DataFrame,
    item_ids: list[int],
    hero_ids: list[int],
    demean: bool = True,
) -> np.ndarray:
    item_index = {item_id: i for i, item_id in enumerate(item_ids)}
    hero_index = {hero_id: i for i, hero_id in enumerate(hero_ids)}

    n = len(df)
    items_mat = np.zeros((n, len(item_ids)), dtype=np.float64)
    heroes_mat = np.zeros((n, len(hero_ids)), dtype=np.float64)

    for row, (build, hero_id) in enumerate(zip(df["items"], df["hero_id"])):
        for item_id in build:
            idx = item_index.get(item_id)
            if idx is not None:
                items_mat[row, idx] = 1.0
        hidx = hero_index.get(hero_id)
        if hidx is not None:
            heroes_mat[row, hidx] = 1.0

    controls = StandardScaler().fit_transform(
        df[CONTROL_COLUMNS].to_numpy(dtype=np.float64)
    )

    X = np.hstack([items_mat, heroes_mat, controls])
    if demean:
        X = demean_by_match(X, df["match_id"].to_numpy())
    return X


def fit_target(
    df: pd.DataFrame,
    X: np.ndarray,
    target: str,
    item_ids: list[int],
    alpha: float,
    evaluate: bool,
    n_splits: int,
) -> TargetFit:
    raw = df[target].to_numpy(dtype=np.float64)
    mean, std = float(raw.mean()), float(raw.std())
    if std == 0:
        std = 1.0
    y = (raw - mean) / std

    model = Ridge(alpha=alpha)
    model.fit(X, y)
    coefs = model.coef_

    r2 = 0.0
    if evaluate:
        scores = cross_val_score(
            Ridge(alpha=alpha), X, y,
            groups=df["match_id"].to_numpy(),
            cv=GroupKFold(n_splits=n_splits), scoring="r2",
        )
        r2 = float(scores.mean())

    fit = TargetFit(
        target=target,
        item_coefficients={iid: float(coefs[i]) for i, iid in enumerate(item_ids)},
        target_std=std,
        target_mean=mean,
        r2_cv=r2,
    )

    # Per-hero nudges from model residuals: "for this hero, owning this item
    # goes with performing above/below what the pooled fit predicted". Using
    # residuals means every control is already accounted for, and shrinkage
    # collapses thin (hero, item) pairs back toward the pooled coefficient.
    residuals = y - model.predict(X)
    sums: dict[tuple[int, int], float] = {}
    counts: dict[tuple[int, int], int] = {}
    for hero_id, build, resid in zip(df["hero_id"], df["items"], residuals):
        for item_id in build:
            key = (int(hero_id), int(item_id))
            sums[key] = sums.get(key, 0.0) + float(resid)
            counts[key] = counts.get(key, 0) + 1

    fit.hero_adjustments = {
        key: (sums[key] / n) * (n / (n + HERO_SHRINKAGE_N))
        for key, n in counts.items()
    }
    return fit


def train(
    df: pd.DataFrame,
    alpha: float = 10.0,
    demean: bool = True,
    evaluate: bool = True,
    n_splits: int = 5,
) -> PerformanceModel:
    df = add_targets(add_build_controls(df))
    item_ids = sorted(load_items())
    hero_ids = sorted(df["hero_id"].unique().tolist())
    X = build_matrix(df, item_ids, hero_ids, demean=demean)

    fits = {
        name: fit_target(df, X, name, item_ids, alpha, evaluate, n_splits)
        for name in TARGETS
    }

    counts: dict[int, int] = {item_id: 0 for item_id in item_ids}
    for build in df["items"]:
        for item_id in build:
            if item_id in counts:
                counts[item_id] += 1

    hero_games = df.groupby("hero_id").size().to_dict()

    return PerformanceModel(
        fits=fits,
        item_counts=counts,
        hero_game_counts={int(k): int(v) for k, v in hero_games.items()},
        n_rows=len(df),
        n_matches=int(df["match_id"].nunique()),
    )
