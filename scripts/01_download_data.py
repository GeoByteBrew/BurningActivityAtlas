# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Download FIRMS MODIS / VIIRS detections for the AOI bbox (resumable).

Usage:
    python scripts/01_download_data.py                 # all configured sources, full period
    python scripts/01_download_data.py --source MODIS_SP --start 2019-07-01 --end 2019-08-31
    python scripts/01_download_data.py --check         # only MAP_KEY status + data availability

Each chunk is saved as data/raw/<region>/<SOURCE>/<SOURCE>[_<box>]_<YYYYMMDD>_<n>d.csv; existing
files are skipped, so an interrupted download resumes where it stopped.

Large domains: with firms.tile_deg set, the request box is cut into tiles (one file per tile and
chunk). For the whole world the API is the slow road (hundreds of thousands of requests under the
FIRMS transaction limit). The yearly archive files from the FIRMS archive download are the fast
one: drop the CSVs, whatever their extent, into data/raw/<region>/<SOURCE>/. The QC stage reads
every CSV in those folders and routes each row to its processing tile itself.
"""
import _bootstrap  # noqa: F401

import math
import time
from datetime import date

import pandas as pd

from mvh import firms
from mvh.config import cli, load_config, raw_dir, record_start, setup_logging

log = setup_logging("01_download")


def plan_sources(cfg, avail: pd.DataFrame, only: str | None):
    end = date.fromisoformat(cfg["period"]["end"])
    by_id = avail.set_index("data_id") if "data_id" in avail else pd.DataFrame()
    plans = []
    for src in cfg["firms"]["sources"]:
        sid = src["source"]
        start = date.fromisoformat(record_start(cfg) if src.get("sensor") == "MODIS" else cfg["period"]["start"])
        if only and sid != only:
            continue
        if sid not in by_id.index:
            fb = cfg["firms"].get("nrt_fallback", {}).get(sid)
            if fb and fb in by_id.index:
                log.warning("%s not offered by FIRMS; falling back to %s (NRT, flag in QC!)", sid, fb)
                src = {**src, "source": fb}
                sid = fb
            else:
                log.warning("%s not offered by FIRMS — skipped", sid)
                continue
        row = by_id.loc[sid]
        s = max(start, row["min_date"])
        e = min(end, row["max_date"])
        if s > e:
            log.warning("%s: no data in period (%s .. %s)", sid, row["min_date"], row["max_date"])
            continue
        plans.append((src, s, e))
    return plans


def request_boxes(bbox: list[float], tile_deg: float | None) -> list[tuple[str, list[float]]]:
    """(tag, [W, S, E, N]) request boxes: the bbox itself, or tiles on a tile_deg lattice."""
    if not tile_deg:
        return [("", list(bbox))]
    w, s, e, n = bbox
    out = []
    x = math.floor(w / tile_deg) * tile_deg
    while x < e:
        y = math.floor(s / tile_deg) * tile_deg
        while y < n:
            b = [max(w, x), max(s, y), min(e, x + tile_deg), min(n, y + tile_deg)]
            tag = f"{'E' if x >= 0 else 'W'}{abs(int(x)):03d}{'N' if y >= 0 else 'S'}{abs(int(y)):02d}"
            out.append((tag, b))
            y += tile_deg
        x += tile_deg
    return out


def main():
    ap = cli(__doc__)
    ap.add_argument("--source")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.start:
        cfg["period"]["start"] = args.start
        cfg["period"].pop("modis_start", None)
    if args.end:
        cfg["period"]["end"] = args.end
    key = firms.get_map_key(cfg)
    log.info("MAP_KEY status: %s", firms.mapkey_status(cfg, key))
    avail = firms.data_availability(cfg, key)
    log.info("FIRMS data availability:\n%s", avail.to_string(index=False))
    if args.check:
        return

    raw_root = raw_dir(cfg)
    boxes = request_boxes(cfg["aoi"]["bbox_wgs84"], cfg["firms"].get("tile_deg"))
    manifest = []
    for src, s, e in plan_sources(cfg, avail, args.source):
        sid = src["source"]
        out_dir = raw_root / sid
        out_dir.mkdir(parents=True, exist_ok=True)
        chunks = list(firms.date_chunks(s, e, cfg["firms"]["day_range"]))
        total = len(chunks) * len(boxes)
        log.info("%s: %s .. %s (%d requests in %d box(es))", sid, s, e, total, len(boxes))
        k = 0
        for tag, bbox in boxes:
            for d, n in chunks:
                k += 1
                f = out_dir / (f"{sid}_{tag}_{d:%Y%m%d}_{n}d.csv" if tag else f"{sid}_{d:%Y%m%d}_{n}d.csv")
                if f.exists():
                    continue
                text = firms.fetch_area_csv(cfg, key, sid, bbox, d, n)
                f.write_text(text, encoding="utf-8")
                n_rows = max(0, len(text.strip().splitlines()) - 1)
                manifest.append({"source": sid, "box": tag, "start": d, "n_days": n, "rows": n_rows, "file": f.name})
                if k % 50 == 0:
                    log.info("  %s %d/%d", sid, k, total)
                time.sleep(cfg["firms"]["pause_s"])
    if manifest:
        m = pd.DataFrame(manifest)
        mf = raw_root / "download_manifest.csv"
        m.to_csv(mf, mode="a", header=not mf.exists(), index=False)
        log.info("downloaded %d chunks, %d detections", len(m), m["rows"].sum())
    else:
        log.info("nothing new to download")


if __name__ == "__main__":
    main()
