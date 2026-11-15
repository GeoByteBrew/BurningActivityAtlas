// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import type { ReactNode } from "react";
import type { DatasetEntry, Meta } from "../types";

export function FlameMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="fm" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff4d2e" />
          <stop offset="0.6" stopColor="#ff9a3d" />
          <stop offset="1" stopColor="#ffe08a" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="none" stroke="rgba(56,208,255,0.55)" strokeWidth="1.2" strokeDasharray="3 2.5" />
      <path d="M16 5c1.2 4.6 6 6.8 6 12.4a6 6 0 0 1-12 0c0-2.4 1.1-4.1 2.4-5.3 0 2.3 1.1 3.5 2.4 3.6-1.2-3.6 0-7 1.2-10.7z" fill="url(#fm)" />
    </svg>
  );
}

export default function Header({
  meta,
  onAbout,
  onMethod,
  onStory,
  storyLabel,
  onArea,
  areaOn,
  datasets,
  datasetId,
  onDataset,
  children,
}: {
  datasets?: DatasetEntry[];
  datasetId?: string;
  onDataset?: (id: string) => void;
  meta: Meta;
  onAbout: () => void;
  onMethod: () => void;
  onStory?: () => void;
  storyLabel: string;
  onArea?: () => void;
  areaOn?: boolean;
  children?: ReactNode;
}) {
  const [y0, y1] = [meta.years[0], meta.years.at(-1)];
  const ref = meta.reference_platform;
  const viirsEnd = meta.coverage[ref]?.end ?? "";
  const partial = viirsEnd < meta.period[1].slice(0, 7);
  return (
    <header className="topbar glass">
      <div className="brand">
        <FlameMark />
        <div>
          <h1>{meta.title}</h1>
          <p>
            MODIS × VIIRS fire activity, harmonized · {meta.region_name} · {y0}–{y1}
          </p>
        </div>
      </div>
      <div className="topbar-right">
        {datasets && datasets.length > 1 && onDataset && (
          <label
            className="dataset-pick"
            title="World at 50 km. Zoom for 25 km, then a named window for 10 km and 5 km (or pick the window here)."
          >
            <span>View</span>
            <select
              value={
                (datasetId ?? "").endsWith("_10km")
                  ? (datasetId ?? "").replace(/_10km$/, "")
                  : (datasetId ?? "").endsWith("_25km")
                    ? (datasetId ?? "").replace(/_25km$/, "")
                    : datasetId
              }
              onChange={(e) => onDataset(e.target.value)}
            >
              {datasets
                .filter((d) => d.kind !== "mid" && d.kind !== "coarse")
                .map((d) => {
                  // Zoom LOD keeps world_25km out of the list; show the live cell size on World.
                  const liveKm =
                    d.id === "world" && (datasetId === "world" || datasetId === "world_25km")
                      ? (datasets.find((x) => x.id === datasetId)?.cell_size_m ?? d.cell_size_m) / 1000
                      : d.cell_size_m / 1000;
                  return (
                    <option key={d.id} value={d.id}>
                      {d.name} · {liveKm} km
                    </option>
                  );
                })}
            </select>
          </label>
        )}
        <span className="pill">
          <span className="dot ok" /> NASA FIRMS · {meta.cell_size_m / 1000} km EASE-Grid 2.0
        </span>
        {partial && (
          <span className="pill warn" title={`${ref} detections are loaded up to ${viirsEnd}. Re-run the pipeline when the download finishes.`}>
            <span className="dot warn" /> VIIRS loaded to {viirsEnd.slice(0, 7)}
          </span>
        )}
        {!meta.harmonized && (
          <span className="pill muted" title="Run scripts/06_harmonize.py, then scripts/07_export_web.py">
            Harmonized layer pending
          </span>
        )}
        {onStory && (
          <button className="btn story" onClick={onStory} title="Jump to an example of an unusual fire month">
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
              <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
            </svg>
            <span className="btn-label">Story: {storyLabel}</span>
          </button>
        )}
        {onArea && (
          <button className={`btn ghost ${areaOn ? "on" : ""}`} onClick={onArea} title="Upload or draw a boundary and get its fire record">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
              <path d="M5 6l7-3 7 4-1 10-8 4-6-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="5" cy="6" r="1.6" fill="currentColor" />
              <circle cx="19" cy="7" r="1.6" fill="currentColor" />
              <circle cx="10" cy="21" r="1.6" fill="currentColor" />
            </svg>
            <span className="btn-label">Your area</span>
          </button>
        )}
        {children}
        {meta.harmonized && (
          <button className="btn ghost" onClick={onMethod} title="Validation of the MODIS → VIIRS harmonization">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
              <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span className="btn-label">Method</span>
          </button>
        )}
        <button className="btn ghost" onClick={onAbout}>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 11v6M12 7.5v.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="btn-label">How it works</span>
        </button>
      </div>
    </header>
  );
}
