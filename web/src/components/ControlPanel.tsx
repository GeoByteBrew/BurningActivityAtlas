// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { useEffect, useRef, useState } from "react";
import { SENSOR_COLORS } from "../colors";
import { fmt } from "../data";
import type { ColorMode, Layer, Meta, Sensor } from "../types";

interface Props {
  meta: Meta;
  sensor: Sensor;
  colorMode: ColorMode;
  layer: Layer;
  region: string;
  country: string;
  regionTotals: Record<string, number>;
  setSensor: (s: Sensor) => void;
  setColorMode: (m: ColorMode) => void;
  setLayer: (l: Layer) => void;
  setRegion: (r: string) => void;
  setCountry: (c: string) => void;
}

const COMPARE: { id: Sensor; label: string; color: string; help: string }[] = [
  { id: "modis", label: "MODIS", color: SENSOR_COLORS.modis, help: "Terra + Aqua, 1 km pixels. Long record (2000–) but misses small fires." },
  { id: "viirs", label: "VIIRS", color: SENSOR_COLORS.viirs, help: "Suomi NPP, 375 m pixels. Sees several times more fire pixels than MODIS over the same ground." },
];

const DIAG: Partial<Record<Sensor, string>> = {
  diff: "Map shows the raw sensor gap (VIIRS − MODIS). Open Method for details, or pick Harmonized / MODIS / VIIRS above.",
  convdiff: "Map shows the residual after conversion (converted MODIS − VIIRS). Open Method for details, or pick Harmonized / MODIS / VIIRS above.",
};

function CoverageBar({ meta, platform }: { meta: Meta; platform: string }) {
  const c = meta.coverage[platform];
  const t0 = Date.parse(meta.period[0]);
  const t1 = Date.parse(meta.period[1]);
  const f = (d: string) => Math.min(1, Math.max(0, (Date.parse(d) - t0) / (t1 - t0)));
  const color = meta.modis_platforms.includes(platform) ? SENSOR_COLORS.modis : SENSOR_COLORS.viirs;
  return (
    <div className="cov-row" title={c ? `${c.start} → ${c.end} · ${c.n.toLocaleString()} detections` : "not downloaded"}>
      <span className="cov-name">{platform}</span>
      <div className="cov-track">
        {c && <div className="cov-fill" style={{ left: `${f(c.start) * 100}%`, width: `${(f(c.end) - f(c.start)) * 100}%`, background: color }} />}
      </div>
      <span className="cov-n">{c ? fmt(c.n) : "–"}</span>
    </div>
  );
}

function PlaceDropdown({
  label,
  value,
  display,
  options,
  totals,
  allLabel,
  onPick,
}: {
  label: string;
  value: string;
  display: string;
  options: string[];
  totals: Record<string, number>;
  allLabel: string;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="region-dd" ref={box}>
      <button
        type="button"
        className={`region-dd-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
      >
        <span className="region-dd-label">
          <span>{display}</span>
          <span className="num">{fmt(totals[value] ?? 0)}</span>
        </span>
        <svg className="region-dd-caret" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="region-dd-menu" role="listbox" aria-label={label}>
          {options.map((r) => (
            <button
              key={r}
              type="button"
              role="option"
              aria-selected={value === r}
              className={value === r ? "on" : ""}
              onClick={() => {
                onPick(r);
                setOpen(false);
              }}
            >
              <span>{r === "All" ? allLabel : r}</span>
              <span className="num">{fmt(totals[r] ?? 0)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ControlPanel(p: Props) {
  const harm = p.sensor === "harm";
  const compareHelp = COMPARE.find((s) => s.id === p.sensor)?.help;
  const diagHelp = DIAG[p.sensor];
  const cell = `${p.meta.cell_size_m / 1000} km`;
  const noPoints = p.meta.points === false;
  const onPoints = p.layer === "points";
  const regions = ["All", ...p.meta.regions];
  const regionLabel = p.region === "All" ? p.meta.region_name : p.region;
  const countryList = p.region !== "All" ? p.meta.region_countries?.[p.region] ?? [] : [];
  const showCountry = !!p.meta.region_countries && p.region !== "All" && countryList.length > 0;
  const countryOptions = ["All", ...countryList];
  const countryLabel = p.country === "All" ? "All countries in region" : p.country;

  return (
    <aside className="panel left glass">
      <section>
        <h3>
          <span className="step">1</span> Fire activity
        </h3>
        <button className={`hero-choice ${harm ? "on" : ""}`} disabled={!p.meta.harmonized} onClick={() => p.setSensor("harm")}>
          <span className="hero-title">
            <i style={{ background: SENSOR_COLORS.harm }} /> Harmonized
          </span>
          <span className="hero-sub">One record on the VIIRS scale (VIIRS-equivalent detection counts)</span>
        </button>
        {harm && (
          <div className="seg mode-seg">
            <button className={p.colorMode === "anomaly" ? "on" : ""} disabled={onPoints} onClick={() => p.setColorMode("anomaly")}>
              Ratio to normal
            </button>
            <button className={p.colorMode === "count" ? "on" : ""} disabled={onPoints} onClick={() => p.setColorMode("count")}>
              Raw count
            </button>
          </div>
        )}
        {harm && (
          <p className="help">
            {onPoints
              ? `Colour modes apply to the ${cell} grid. Switch the map layer (step 3) to the grid to use them.`
              : p.colorMode === "anomaly"
                ? `Red: more fire than usual for these months (${p.meta.calibration.baseline_years.join("–")}). Blue: quieter than usual.`
                : `Number of harmonized fire detections per ${cell} cell in the selected period. Brighter red = more fire.`}
          </p>
        )}

        <div className="sub-head">Compare sensors</div>
        <div className="seg">
          {COMPARE.map((s) => (
            <button key={s.id} className={p.sensor === s.id ? "on" : ""} title={s.help} onClick={() => p.setSensor(s.id)}>
              <i style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
        {compareHelp && <p className="help">{compareHelp}</p>}
        {diagHelp && <p className="help">{diagHelp}</p>}
      </section>

      <section>
        <h3>
          <span className="step">2</span> Region
        </h3>
        <PlaceDropdown
          label="Region"
          value={p.region}
          display={regionLabel}
          options={regions}
          totals={p.regionTotals}
          allLabel={p.meta.region_name}
          onPick={p.setRegion}
        />
        {showCountry && (
          <>
            <div className="sub-head" style={{ marginTop: 10 }}>
              Country
            </div>
            <PlaceDropdown
              label="Country"
              value={p.country}
              display={countryLabel}
              options={countryOptions}
              totals={p.regionTotals}
              allLabel="All countries in region"
              onPick={p.setCountry}
            />
          </>
        )}
      </section>

      <section>
        <h3>
          <span className="step">3</span> Map layer
        </h3>
        <div className="seg">
          <button className={p.layer === "grid" ? "on" : ""} onClick={() => p.setLayer("grid")}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <rect x="1" y="8" width="3.5" height="7" fill="currentColor" />
              <rect x="6.25" y="3" width="3.5" height="12" fill="currentColor" />
              <rect x="11.5" y="6" width="3.5" height="9" fill="currentColor" />
            </svg>
            {cell} grid
          </button>
          <button
            className={p.layer === "points" ? "on" : ""}
            disabled={noPoints}
            title={noPoints ? "Single detections are available in the regional views (switch with View, top right)" : undefined}
            onClick={() => p.setLayer("points")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <circle cx="4" cy="5" r="2" fill="currentColor" />
              <circle cx="11" cy="4" r="1.4" fill="currentColor" />
              <circle cx="9" cy="11" r="2.6" fill="currentColor" />
              <circle cx="3" cy="12" r="1.2" fill="currentColor" />
            </svg>
            Detections
          </button>
        </div>
      </section>

      <section className="data-block">
        <h3>Data loaded</h3>
        {p.meta.platforms.map((pl) => (
          <CoverageBar key={pl} meta={p.meta} platform={pl} />
        ))}
        <div className="cov-axis">
          <span>{p.meta.period[0].slice(0, 4)}</span>
          <span>{p.meta.period[1].slice(0, 4)}</span>
        </div>
        <p className="help small">
          Quality filter {p.meta.qc_scenario}: {p.meta.qc_description}. Vegetation fires only. Harmonized series uses{" "}
          {p.meta.reference_platform} as reference; when it is down, MODIS converted with the calibrated factor
          {p.meta.backup_platforms?.length
            ? ` (optional VIIRS backups ${p.meta.backup_platforms.join(" / ")} when configured)`
            : ""}
          .
          {p.meta.points_dropped ? ` Detections layer: the ${fmt(p.meta.points_dropped)} weakest detections are not drawn.` : ""}
        </p>
      </section>
    </aside>
  );
}
