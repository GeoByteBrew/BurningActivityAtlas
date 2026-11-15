# AI disclosure: written with the assistance of an AI tool (large language model). See AI_USE.md.
"""NASA FIRMS API client (area endpoint, data availability, MAP_KEY status)."""
from __future__ import annotations

import io
import os
import time
from datetime import date, timedelta
from typing import Iterator

import pandas as pd
import requests


class FirmsError(RuntimeError):
    pass


def get_map_key(cfg: dict) -> str:
    env = cfg["firms"]["map_key_env"]
    key = os.environ.get(env, "").strip()
    if not key:
        raise FirmsError(
            f"{env} is not set. Get a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ "
            f"and put `{env}=...` into the project's .env file."
        )
    return key


def _get(url: str, max_retries: int = 5, timeout: int = 120, params: dict | None = None) -> str:
    delay = 5.0
    for attempt in range(1, max_retries + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout)
        except requests.RequestException as e:
            err = str(e)
        else:
            if r.status_code == 200:
                return r.text
            err = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code not in (429, 500, 502, 503, 504):
                raise FirmsError(err)
        if attempt == max_retries:
            raise FirmsError(f"giving up after {max_retries} attempts: {err}")
        time.sleep(delay)
        delay = min(delay * 2, 120)
    raise AssertionError("unreachable")


def mapkey_status(cfg: dict, key: str) -> dict:
    text = _get(cfg["firms"]["mapkey_status_url"], params={"MAP_KEY": key})
    try:
        import json

        return json.loads(text)
    except ValueError:
        return {"raw": text[:300]}


def _get_within_quota(cfg: dict, key: str, url: str, max_wait_s: int = 900) -> str:
    """GET that waits for the MAP_KEY transaction window to reset instead of failing.

    FIRMS answers "Invalid MAP_KEY." (HTTP 400) both for a wrong key and for an exhausted
    transaction quota; the status endpoint tells the two apart.
    """
    waited = 0
    while True:
        try:
            return _get(url, max_retries=cfg["firms"]["max_retries"])
        except FirmsError as e:
            if "Invalid MAP_KEY" not in str(e):
                raise
            st = mapkey_status(cfg, key)
            used, limit = st.get("current_transactions"), st.get("transaction_limit")
            if used is None or limit is None or used < limit * 0.9 or waited >= max_wait_s:
                raise
            time.sleep(60)
            waited += 60


def data_availability(cfg: dict, key: str) -> pd.DataFrame:
    """Table with columns data_id, min_date, max_date for every FIRMS source."""
    text = _get(f"{cfg['firms']['api_base']}/data_availability/csv/{key}/ALL")
    df = pd.read_csv(io.StringIO(text))
    for c in ("min_date", "max_date"):
        if c in df:
            df[c] = pd.to_datetime(df[c]).dt.date
    return df


def date_chunks(start: date, end: date, day_range: int) -> Iterator[tuple[date, int]]:
    """Yield (chunk_start, n_days) covering [start, end] inclusive."""
    d = start
    while d <= end:
        n = min(day_range, (end - d).days + 1)
        yield d, n
        d += timedelta(days=n)


def fetch_area_csv(cfg: dict, key: str, source: str, bbox: list[float], start: date, n_days: int) -> str:
    """Raw CSV text for `n_days` starting at `start` (header-only text means no detections)."""
    w, s, e, n = bbox
    url = f"{cfg['firms']['api_base']}/area/csv/{key}/{source}/{w},{s},{e},{n}/{n_days}/{start.isoformat()}"
    text = _get_within_quota(cfg, key, url)
    head = text.lstrip()[:20].lower()
    if text.strip() and not head.startswith(("latitude", "country_id")):
        # FIRMS returns plain-text error messages with HTTP 200 (e.g. "Invalid MAP_KEY.")
        raise FirmsError(f"{source} {start}: unexpected response: {text[:200]!r}")
    return text
