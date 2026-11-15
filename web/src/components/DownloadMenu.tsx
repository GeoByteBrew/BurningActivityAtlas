// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { cellRatio, rangeLabel, regionMonthly } from "../data";
import type { Dataset, Range, Sensor } from "../types";

interface Props {
  data: Dataset;
  region: string;
  range: Range;
  sensor: Sensor;
  values: Float64Array;
  medians: Float64Array;
  getViewer: () => Viewer | null;
}

const SVG_STYLE_PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-family", "font-weight"];

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csv(rows: (string | number)[][]): Blob {
  const esc = (v: string | number) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
  return new Blob([rows.map((r) => r.map(esc).join(",")).join("\n") + "\n"], { type: "text/csv" });
}

async function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll("*");
  const dst = clone.querySelectorAll("*");
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const d = dst[i] as SVGElement;
    for (const p of SVG_STYLE_PROPS) d.style.setProperty(p, cs.getPropertyValue(p));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  URL.revokeObjectURL(url);
  return img;
}

const canvasBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));

export default function DownloadMenu({ data, region, range, sensor, values, medians, getViewer }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { meta, cells } = data;
  const label = rangeLabel(meta, range);
  const slug = `${region === "All" ? "iberia-occitanie" : region.toLowerCase()}_${label.replace(/[^\w]+/g, "-")}`;
  const title = `${meta.title} · ${region === "All" ? meta.region_name : region} · ${label}`;

  useEffect(() => {
    if (!open) return;
    // pointerdown also fires for taps on the globe, where Cesium suppresses the emulated mousedown
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const run = (name: string, fn: () => Promise<void> | void) => async () => {
    setBusy(name);
    try {
      await fn();
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const seriesCsv = () => {
    const rm = regionMonthly(meta, data.series.regions[region] ?? data.series.regions.All);
    const rows: (string | number)[][] = [
      ["month", "harmonized", "normal_median", "ratio_to_normal", "modis_raw_terra_aqua", `viirs_raw_${meta.reference_platform}`, "modis_converted_viirs_eq", "days_available"],
    ];
    for (let k = range.start; k <= range.end; k++) {
      const med = rm.median[k % 12];
      rows.push([
        data.series.months[k],
        rm.harm[k],
        med,
        med > 0 ? +(rm.harm[k] / med).toFixed(3) : "",
        rm.modis[k],
        rm.viirs[k],
        rm.conv[k],
        rm.days[k],
      ]);
    }
    save(csv(rows), `fire_activity_${slug}.csv`);
  };

  const cellsCsv = () => {
    const rIdx = region === "All" ? -2 : cells.regions.indexOf(region);
    const rows: (string | number)[][] = [["cell_id", "region", "lat", "lon", `${sensor}_detections`, "normal_baseline_mean", "ratio_to_normal_damped"]];
    for (let i = 0; i < cells.id.length; i++) {
      if (rIdx !== -2 && cells.region[i] !== rIdx) continue;
      if (values[i] === 0 && medians[i] === 0) continue;
      rows.push([
        cells.id[i],
        cells.regions[cells.region[i]] ?? "",
        +((cells.s[i] + cells.n[i]) / 2).toFixed(4),
        +((cells.w[i] + cells.e[i]) / 2).toFixed(4),
        +values[i].toFixed(2),
        +medians[i].toFixed(2),
        +cellRatio(values[i], medians[i]).toFixed(3),
      ]);
    }
    save(csv(rows), `cells_${data.meta.cell_size_m / 1000}km_${sensor}_${slug}.csv`);
  };

  const chartsPng = async () => {
    const sections = [...document.querySelectorAll<HTMLElement>(".panel.right [data-chart]")];
    const items = await Promise.all(
      sections.map(async (s) => ({ title: s.querySelector("h3")?.textContent ?? "", img: await svgImage(s.querySelector("svg")!) })),
    );
    const insight = document.querySelector(".panel.right .insight p")?.textContent ?? "";
    const scale = 2;
    const pad = 24;
    const w = Math.max(...items.map((i) => i.img.width)) + pad * 2;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    g.font = "12px Inter, sans-serif";
    const lines: string[] = [];
    for (const word of insight.split(/\s+/)) {
      const cur = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
      if (lines.length && g.measureText(cur).width <= w - pad * 2) lines[lines.length - 1] = cur;
      else lines.push(word);
    }
    const textH = lines.length * 17;
    const h = pad + 40 + textH + items.reduce((s, i) => s + i.img.height + 34, 0) + pad;
    c.width = w * scale;
    c.height = h * scale;
    g.scale(scale, scale);
    g.fillStyle = "#0b101a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#e8edf5";
    g.font = "600 15px Inter, sans-serif";
    g.fillText(title, pad, pad + 14);
    g.fillStyle = "#8d99ad";
    g.font = "12px Inter, sans-serif";
    lines.forEach((l, i) => g.fillText(l, pad, pad + 36 + i * 17));
    let y = pad + 50 + textH;
    for (const it of items) {
      g.fillStyle = "#8d99ad";
      g.font = "600 11px Inter, sans-serif";
      g.fillText(it.title.toUpperCase(), pad, y);
      g.drawImage(it.img, pad, y + 10);
      y += it.img.height + 34;
    }
    save(await canvasBlob(c), `charts_${slug}.png`);
  };

  const mapPng = async () => {
    const v = getViewer();
    if (!v) return;
    v.render();
    const src = v.canvas;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height + 44;
    const g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    g.fillStyle = "#0b101a";
    g.fillRect(0, src.height, c.width, 44);
    g.fillStyle = "#e8edf5";
    g.font = "600 18px Inter, sans-serif";
    g.fillText(title, 16, src.height + 28);
    g.fillStyle = "#8d99ad";
    g.font = "13px Inter, sans-serif";
    g.textAlign = "right";
    g.fillText("NASA FIRMS · MODIS × VIIRS", c.width - 16, src.height + 28);
    save(await canvasBlob(c), `map_${sensor}_${slug}.png`);
  };

  return (
    <div className="dl" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="btn-label">Download</span>
      </button>
      {open && (
        <div className="dl-menu glass">
          <span className="dl-head">{title}</span>
          <button onClick={run("series", seriesCsv)}>
            <b>Monthly series (CSV)</b>
            <span>Harmonized, normal, ratio, raw MODIS / VIIRS for this region and period</span>
          </button>
          <button onClick={run("cells", cellsCsv)}>
            <b>{data.meta.cell_size_m / 1000} km cells (CSV)</b>
            <span>Per-cell totals and ratio to normal, ready for GIS</span>
          </button>
          <button onClick={run("charts", chartsPng)}>
            <b>Charts (PNG)</b>
            <span>Insight, annual, monthly and calendar charts</span>
          </button>
          <button onClick={run("map", mapPng)}>
            <b>Map view (PNG)</b>
            <span>Current globe view with caption</span>
          </button>
          {busy && <span className="dl-busy">Preparing {busy}…</span>}
        </div>
      )}
    </div>
  );
}
