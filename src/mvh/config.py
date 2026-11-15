"""Configuration loading and project paths.

The active configuration is chosen, in this order, by: the `path` argument, `--config` on the
command line (see `cli`), the MVH_CONFIG environment variable, then config/config.yaml (the world).
A config file may start from another one with `extends: <file>`; values are deep-merged, so
config/world_test_2019.yaml and config/iberia.yaml only list what differs from the world run.
"""
from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _read(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    parent = cfg.pop("extends", None)
    if parent:
        cfg = _merge(_read((path.parent / parent).resolve()), cfg)
    return cfg


def load_config(path: str | Path | None = None) -> dict:
    path = Path(path or os.environ.get("MVH_CONFIG") or ROOT / "config" / "config.yaml")
    if not path.is_absolute() and not path.exists():
        path = ROOT / path
    cfg = _read(path)
    cfg["_file"] = str(path)
    _load_dotenv()
    return cfg


def cli(description: str | None = None) -> argparse.ArgumentParser:
    """Argument parser shared by the pipeline scripts (config file, partition filter, workers)."""
    ap = argparse.ArgumentParser(description=description, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="config file (default: $MVH_CONFIG or config/config.yaml)")
    ap.add_argument("--tiles", help="comma-separated tile ids to process (default: all)")
    ap.add_argument("--jobs", type=int, default=None, help="worker processes (default: run.jobs in the config)")
    ap.add_argument("--force", action="store_true", help="rebuild outputs that already exist")
    return ap


def is_global(cfg: dict) -> bool:
    return cfg["aoi"].get("mode", "parts") == "countries" and not cfg["aoi"].get("clip", True)


def record_start(cfg: dict) -> str:
    """First day of the harmonized record: the MODIS backcast start if configured, else period.start."""
    p = cfg["period"]
    return min(p["start"], p.get("modis_start") or p["start"])


def path(cfg: dict, key: str) -> Path:
    """Absolute path for a key under `paths:`; the directory is created if missing."""
    p = ROOT / cfg["paths"][key]
    p.mkdir(parents=True, exist_ok=True)
    return p


def raw_dir(cfg: dict) -> Path:
    """Raw FIRMS files of the configured region: data/raw/<region>/<SOURCE>/."""
    p = path(cfg, "raw") / cfg["project"]["region"]
    p.mkdir(parents=True, exist_ok=True)
    return p


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(env, override=False)
    except ImportError:  # minimal fallback
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def setup_logging(name: str) -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    return logging.getLogger(name)
