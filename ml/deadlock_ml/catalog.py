"""Item and hero catalogs loaded from the raw Deadlock API exports."""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RAW = ROOT / "data" / "raw"

CATEGORIES = ("weapon", "vitality", "spirit")


@dataclass(frozen=True)
class ShopItem:
    item_id: int
    class_name: str
    name: str
    category: str
    tier: int
    cost: int


@dataclass(frozen=True)
class Hero:
    hero_id: int
    class_name: str
    name: str
    hero_type: str | None


@lru_cache(maxsize=1)
def load_items() -> dict[int, ShopItem]:
    with open(RAW / "deadlock_items.json") as f:
        raw = json.load(f)
    return {
        it["id"]: ShopItem(
            item_id=it["id"],
            class_name=it["class_name"],
            name=it["name"],
            category=it["item_slot_type"],
            tier=it["item_tier"],
            cost=it["cost"],
        )
        for it in raw
        if it.get("item_slot_type") in CATEGORIES and it.get("shopable")
    }


@lru_cache(maxsize=1)
def load_heroes() -> dict[int, Hero]:
    with open(RAW / "deadlock_heroes.json") as f:
        raw = json.load(f)
    return {
        h["id"]: Hero(
            hero_id=h["id"],
            class_name=h["class_name"],
            name=h["name"],
            hero_type=h.get("hero_type"),
        )
        for h in raw
        if h.get("player_selectable") and not h.get("disabled")
    }


def hero_by_name(name: str) -> Hero | None:
    """Case-insensitive hero lookup by display name or class name."""
    target = name.strip().lower()
    for hero in load_heroes().values():
        if hero.name.lower() == target or hero.class_name.lower() == target:
            return hero
    # fall back to prefix match so "grey" finds "Grey Talon"
    matches = [h for h in load_heroes().values() if h.name.lower().startswith(target)]
    return matches[0] if len(matches) == 1 else None
