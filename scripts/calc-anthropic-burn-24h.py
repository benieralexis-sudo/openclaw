#!/usr/bin/env python3
"""Calcule le burn Anthropic projete sur 24h, fenetre glissante.

P18 (Vague 3 perfection 100%) — alerte budget. Les logs Anthropic dans
/var/log/dashboard-v2.log n'ont pas de timestamp, on maintient donc un
etat persistant `/tmp/anthropic-burn-state.json` capture du cout cumule
au dernier run + epoch. Le delta est extrapole sur 24h.

Usage:
  calc-anthropic-burn-24h.py [--update-state]

Sortie stdout JSON:
  {"burn_24h_usd": 1.23, "delta_usd": 0.45, "delta_seconds": 3600,
   "total_cost_usd": 12.34, "lines_count": 1234,
   "first_run": false, "log_rotated": false}

Exit code: 0 si OK, 1 si log inaccessible.
"""
from __future__ import annotations
import json
import os
import sys
import time
from pathlib import Path

LOG_PATH = "/var/log/dashboard-v2.log"
STATE_PATH = "/tmp/anthropic-burn-state.json"
USAGE_MARKER = "[qualify-trigger.usage]"

# Tarifs Anthropic (USD par 1M tokens) — janvier 2026
PRICING = {
    "claude-opus-4-7":     {"in": 15.00, "out": 75.00, "cache_create": 18.75, "cache_read": 1.50},
    "claude-opus-4-6":     {"in": 15.00, "out": 75.00, "cache_create": 18.75, "cache_read": 1.50},
    "claude-sonnet-4-6":   {"in":  3.00, "out": 15.00, "cache_create":  3.75, "cache_read": 0.30},
    "claude-sonnet-4-5":   {"in":  3.00, "out": 15.00, "cache_create":  3.75, "cache_read": 0.30},
    "claude-haiku-4-5":    {"in":  1.00, "out":  5.00, "cache_create":  1.25, "cache_read": 0.10},
    "claude-haiku-4-5-20251001": {"in": 1.00, "out": 5.00, "cache_create": 1.25, "cache_read": 0.10},
}
DEFAULT_PRICING = PRICING["claude-opus-4-7"]  # fallback conservateur


def line_cost_usd(model: str, in_tk: int, out_tk: int, cc_tk: int, cr_tk: int) -> float:
    p = PRICING.get(model, DEFAULT_PRICING)
    return (
        in_tk * p["in"]
        + out_tk * p["out"]
        + cc_tk * p["cache_create"]
        + cr_tk * p["cache_read"]
    ) / 1_000_000


def total_cost_from_log(log_path: str) -> tuple[float, int]:
    """Retourne (cout_total_usd, nb_lignes_usage) sur le fichier complet."""
    if not os.path.isfile(log_path):
        raise FileNotFoundError(log_path)
    total = 0.0
    n = 0
    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            idx = line.find(USAGE_MARKER)
            if idx < 0:
                continue
            json_part = line[idx + len(USAGE_MARKER):].strip()
            try:
                d = json.loads(json_part)
            except json.JSONDecodeError:
                continue
            model = d.get("model", "claude-opus-4-7")
            in_tk = int(d.get("in", 0) or 0)
            out_tk = int(d.get("out", 0) or 0)
            cc_tk = int(d.get("cache_create", 0) or 0)
            cr_tk = int(d.get("cache_read", 0) or 0)
            total += line_cost_usd(model, in_tk, out_tk, cc_tk, cr_tk)
            n += 1
    return total, n


def load_state(path: str) -> dict | None:
    if not os.path.isfile(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save_state(path: str, state: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, path)


def main() -> int:
    update_state = "--update-state" in sys.argv

    try:
        total_cost, lines = total_cost_from_log(LOG_PATH)
    except FileNotFoundError:
        print(json.dumps({"error": "log file missing", "log_path": LOG_PATH}))
        return 1

    now = int(time.time())
    state = load_state(STATE_PATH)
    log_size = os.path.getsize(LOG_PATH)

    first_run = state is None
    log_rotated = False
    burn_24h = 0.0
    delta_usd = 0.0
    delta_seconds = 0

    if state is not None:
        prev_total = float(state.get("total_cost_usd", 0.0))
        prev_epoch = int(state.get("epoch", 0))
        prev_size = int(state.get("log_size", 0))

        if log_size < prev_size or total_cost < prev_total:
            log_rotated = True
            # Reset baseline, pas de calcul valide ce run
        else:
            delta_usd = total_cost - prev_total
            delta_seconds = max(1, now - prev_epoch)
            if delta_seconds >= 3600:  # au moins 1h de fenetre pour stabilite
                burn_24h = delta_usd * 86400 / delta_seconds

    out = {
        "burn_24h_usd": round(burn_24h, 2),
        "delta_usd": round(delta_usd, 2),
        "delta_seconds": delta_seconds,
        "total_cost_usd": round(total_cost, 2),
        "lines_count": lines,
        "first_run": first_run,
        "log_rotated": log_rotated,
    }
    print(json.dumps(out))

    if update_state:
        # On garde le baseline glissant : reset si delta > 24h pour eviter qu'un
        # vieux baseline domine ; sinon on accumule.
        keep_baseline = (state is not None
                         and not first_run
                         and not log_rotated
                         and delta_seconds < 86400)
        if keep_baseline:
            new_state = {
                "total_cost_usd": float(state.get("total_cost_usd", 0.0)),
                "epoch": int(state.get("epoch", now)),
                "log_size": log_size,
            }
        else:
            new_state = {
                "total_cost_usd": total_cost,
                "epoch": now,
                "log_size": log_size,
            }
        save_state(STATE_PATH, new_state)

    return 0


if __name__ == "__main__":
    sys.exit(main())
