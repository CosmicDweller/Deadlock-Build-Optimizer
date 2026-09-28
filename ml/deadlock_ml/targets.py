"""The objective metrics a build is optimized for.

Everything here comes off the end-of-match stat sheet, so these measure
what the build actually produced rather than whether the team happened to
win. Match outcome depends overwhelmingly on teammates, matchups and who
snowballed first; the stat sheet is the part a build is actually
responsible for.

Rate metrics are per-minute so a 45-minute game doesn't outrank a 20-minute
one purely on elapsed time.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class Target:
    key: str
    label: str
    description: str


TARGETS: dict[str, Target] = {
    "dps": Target("dps", "Hero DPS", "All hero damage dealt per minute"),
    "final_damage": Target("final_damage", "Final Damage", "Total hero damage over the match"),
    "ability_dps": Target("ability_dps", "Ability DPS", "Ability damage dealt per minute"),
    "bullet_dps": Target("bullet_dps", "Bullet DPS", "Gun damage dealt per minute"),
    "ability_reach": Target("ability_reach", "Ability Reach",
                            "Average distance (m) at which ability damage lands"),
    "ability_kills": Target("ability_kills", "Ability Kills", "Kills from abilities per minute"),
    "weapon_power": Target("weapon_power", "Weapon Power", "Final Weapon stat"),
    "spirit_power": Target("spirit_power", "Spirit Power", "Final Spirit stat"),
    "max_health": Target("max_health", "Max Health", "Final Vitality stat"),
    "mitigation": Target("mitigation", "Mitigation", "Damage mitigated per minute"),
    "healing": Target("healing", "Healing", "Healing output per minute"),
}

DEFAULT_WEIGHTS = {"dps": 1.0}


def add_targets(df: pd.DataFrame) -> pd.DataFrame:
    """Attach every objective metric as its own column."""
    df = df.copy()
    minutes = (df["duration_s"] / 60).clip(lower=1)

    df["dps"] = df["player_damage"] / minutes
    df["final_damage"] = df["player_damage"]
    df["spirit_power"] = df["tech_power"]
    df["mitigation"] = df["damage_mitigated"] / minutes
    df["healing"] = df["player_healing"] / minutes

    df["ability_dps"] = df["ability_damage_raw"] / minutes
    df["bullet_dps"] = df["bullet_damage_raw"] / minutes
    df["ability_kills"] = df["ability_kills"] / minutes

    # Damage-weighted mean distance of outgoing ability damage. Undefined for
    # players who dealt no ability damage at all, so those fall back to the
    # population median rather than a misleading zero.
    reach = df["ability_damage_weighted"] / df["ability_damage_raw"].replace(0, pd.NA)
    df["ability_reach"] = pd.to_numeric(reach, errors="coerce").fillna(
        pd.to_numeric(reach, errors="coerce").median()
    )

    # weapon_power and max_health already come through as raw columns.
    return df


def parse_weights(spec: str) -> dict[str, float]:
    """Parse a 'dps=1,max_health=0.5' objective spec."""
    weights: dict[str, float] = {}
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "=" not in chunk:
            raise ValueError(f"Expected name=weight, got {chunk!r}")
        name, raw = chunk.split("=", 1)
        name = name.strip()
        if name not in TARGETS:
            raise ValueError(
                f"Unknown target {name!r}. Available: {', '.join(TARGETS)}"
            )
        weights[name] = float(raw)
    if not weights:
        raise ValueError("No targets given")
    return weights
