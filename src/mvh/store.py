"""Partitioned storage (tile / year) and a small parallel map.

Every stage reads and writes one Parquet file per processing tile (and year), so the same
code handles a 3-tile region and a ~150-tile world: memory is bounded by the busiest tile,
stages are resumable, and tiles run in parallel.
"""
from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, Iterable

import pandas as pd


def part(root: Path, tile: str, year: int | None = None) -> Path:
    f = root / tile / f"{year}.parquet" if year is not None else root / f"{tile}.parquet"
    f.parent.mkdir(parents=True, exist_ok=True)
    return f


def tiles(root: Path) -> list[str]:
    """Tile ids present under a dataset root (sub-directories or <tile>.parquet files)."""
    if not root.exists():
        return []
    return sorted({p.stem if p.is_file() else p.name for p in root.iterdir()
                   if not p.name.startswith("_") and (p.is_dir() or p.suffix == ".parquet")})


def years(root: Path, tile: str) -> list[int]:
    return sorted(int(p.stem) for p in (root / tile).glob("*.parquet"))


def read(root: Path, tile: str, year: int | None = None, columns: list[str] | None = None) -> pd.DataFrame:
    return pd.read_parquet(part(root, tile, year), columns=columns)


def read_tile(root: Path, tile: str, columns: list[str] | None = None) -> pd.DataFrame:
    fr = [pd.read_parquet(root / tile / f"{y}.parquet", columns=columns) for y in years(root, tile)]
    return pd.concat(fr, ignore_index=True) if fr else pd.DataFrame(columns=columns or [])


def read_all(root: Path, columns: list[str] | None = None, only: Iterable[str] | None = None) -> pd.DataFrame:
    """Concatenate a whole <tile>.parquet dataset. Only for small (already aggregated) tables."""
    ts = [t for t in tiles(root) if only is None or t in set(only)]
    fr = [pd.read_parquet(root / f"{t}.parquet", columns=columns) for t in ts if (root / f"{t}.parquet").exists()]
    fr = [f for f in fr if len(f)]
    return pd.concat(fr, ignore_index=True) if fr else pd.DataFrame(columns=columns or [])


def select(all_tiles: list[str], arg: str | None) -> list[str]:
    if not arg:
        return all_tiles
    want = [t.strip() for t in arg.split(",") if t.strip()]
    return [t for t in all_tiles if t in want]


def pmap(fn: Callable, items: list, jobs: int = 1, log=None, what: str = "tile") -> list:
    """Run fn(item) for every item, in `jobs` processes; results in input order."""
    out = [None] * len(items)
    if jobs <= 1 or len(items) <= 1:
        for k, it in enumerate(items):
            out[k] = fn(it)
            if log and (len(items) <= 20 or (k + 1) % 10 == 0 or k + 1 == len(items)):
                log.info("  %s %d/%d done", what, k + 1, len(items))
        return out
    with ProcessPoolExecutor(max_workers=jobs) as ex:
        fut = {ex.submit(fn, it): k for k, it in enumerate(items)}
        for n, f in enumerate(as_completed(fut), 1):
            out[fut[f]] = f.result()
            if log and (len(items) <= 20 or n % 10 == 0 or n == len(items)):
                log.info("  %s %d/%d done", what, n, len(items))
    return out
