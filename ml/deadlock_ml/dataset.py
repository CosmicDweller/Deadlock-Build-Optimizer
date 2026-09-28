"""Turn raw match JSON into a flat player-level table.

One row per (match, player). The `items` column holds the player's FINAL
build: shop items they still owned at the end of the match, de-duplicated.
Ability-level-up events and sold items are dropped — the raw `items` array
mixes all three together.

The match dump is streamed one match at a time rather than read whole.
At 1.2GB of JSON a `json.load` inflates to roughly ten gigabytes of Python
objects, but each match collapses to twelve small rows and is then
discarded, so streaming keeps peak memory to the output table.
"""
from __future__ import annotations

from pathlib import Path

import ijson
import pandas as pd

from .catalog import RAW, load_items

MATCHES_PATH = RAW / "deadlock_matches.json"
CACHE_PATH = Path(__file__).resolve().parent.parent / "cache" / "players.parquet"


# `custom_user_stats` buckets outgoing damage by how far away it landed, as
# "Outgoing Ability Dist##30": <damage>. Summing the ability buckets gives
# total ability damage and summing the bullet buckets gives total gun damage
# — a split `player_damage` alone doesn't expose. Weighting each bucket by
# its distance additionally measures how far out a build lands its abilities,
# which is the only signal in the data for range items like Mystic Expansion.
ABILITY_DIST_PREFIX = "Outgoing Ability Dist##"
BULLET_DIST_PREFIX = "Outgoing Bullet Dist##"
# Buckets are labelled by their upper bound; "Infinite" is the open-ended tail.
BUCKET_DISTANCE = {"10": 10, "20": 20, "30": 30, "40": 40, "50": 50,
                   "75": 75, "100": 100, "Infinite": 125}


def damage_by_distance(custom_stats: dict, prefix: str) -> tuple[float, float]:
    """Return (total damage, distance-weighted damage) for one bucket family."""
    total = 0.0
    weighted = 0.0
    for key, value in custom_stats.items():
        if not key.startswith(prefix):
            continue
        distance = BUCKET_DISTANCE.get(key[len(prefix):])
        if distance is None:
            continue
        total += value
        weighted += value * distance
    return total, weighted


def final_build(player: dict, shop_ids: set[int]) -> list[int]:
    """Shop items the player still held at match end, in purchase order."""
    build: list[int] = []
    seen: set[int] = set()
    for entry in player.get("items") or []:
        item_id = entry["item_id"]
        if item_id not in shop_ids:
            continue  # ability upgrade, not a shop purchase
        if entry.get("sold_time_s"):
            continue  # sold before the match ended
        if item_id in seen:
            continue  # repeated entries are item upgrade events, not re-buys
        seen.add(item_id)
        build.append(item_id)
    return build


def iter_matches(matches_path: Path = MATCHES_PATH):
    """Yield matches one at a time from the top-level JSON array."""
    with open(matches_path, "rb") as f:
        yield from ijson.items(f, "item", use_float=True)


def build_player_table(matches_path: Path = MATCHES_PATH) -> pd.DataFrame:
    shop_ids = set(load_items())
    rows = []
    for match in iter_matches(matches_path):
        # Skip matches that weren't scored normally — abandons and unscored
        # games have outcomes that say nothing about build quality.
        if match.get("not_scored"):
            continue
        winning_team = match.get("winning_team")
        for player in match["players"]:
            if player.get("abandon_match_time_s"):
                continue
            stats = player.get("final_stats") or {}
            custom = stats.get("custom_user_stats") or {}
            ability_damage, ability_weighted = damage_by_distance(custom, ABILITY_DIST_PREFIX)
            bullet_damage, _ = damage_by_distance(custom, BULLET_DIST_PREFIX)
            rows.append({
                "match_id": match["match_id"],
                "account_id": player["account_id"],
                "hero_id": player["hero_id"],
                "team": player["team"],
                "won": int(player["team"] == winning_team),
                "duration_s": match.get("duration_s", 0),
                "average_badge": match.get("average_badge") or 0,
                "match_mode": match.get("match_mode"),
                "net_worth": player.get("net_worth", 0),
                "player_level": player.get("player_level", 0),
                "kills": player.get("kills", 0),
                "deaths": player.get("deaths", 0),
                "assists": player.get("assists", 0),
                "last_hits": player.get("last_hits", 0),
                # End-of-match stat sheet — these are what the build actually
                # produced, and are what the objective function optimizes.
                "weapon_power": stats.get("weapon_power", 0),
                "tech_power": stats.get("tech_power", 0),
                "max_health": stats.get("max_health", 0),
                "player_damage": stats.get("player_damage", 0),
                "damage_mitigated": stats.get("damage_mitigated", 0),
                "player_healing": stats.get("player_healing", 0),
                "damage_taken": stats.get("player_damage_taken", 0),
                "ability_kills": stats.get("ability_kills", 0),
                "ability_damage_raw": ability_damage,
                "ability_damage_weighted": ability_weighted,
                "bullet_damage_raw": bullet_damage,
                "items": final_build(player, shop_ids),
            })

    return pd.DataFrame(rows)


def load_player_table(rebuild: bool = False) -> pd.DataFrame:
    """Build the table (caching to parquet) or read the cached copy."""
    if CACHE_PATH.exists() and not rebuild:
        return pd.read_parquet(CACHE_PATH)
    df = build_player_table()
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(CACHE_PATH, index=False)
    return df
