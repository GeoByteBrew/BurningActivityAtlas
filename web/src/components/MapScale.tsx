// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { useEffect, useState } from "react";
import { Cartesian2, Cartographic, EllipsoidGeodesic, type Viewer } from "cesium";

const NICE_M = [500, 1e3, 2e3, 5e3, 10e3, 20e3, 50e3, 100e3, 200e3, 500e3, 1e6, 2e6, 5e6];
const MAX_BAR_PX = 120;

function formatDist(m: number): string {
  if (m >= 1000) return `${Math.round(m / 1000)} km`;
  return `${Math.round(m)} m`;
}

/** Ground distance under ~100 px at mid-screen → nice round bar length. */
function measure(v: Viewer): { label: string; widthPx: number } | null {
  const canvas = v.scene.canvas;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 40 || h < 40) return null;
  const y = h * 0.55;
  const x0 = w / 2 - 50;
  const x1 = w / 2 + 50;
  const ell = v.scene.globe.ellipsoid;
  const a = v.camera.pickEllipsoid(new Cartesian2(x0, y), ell);
  const b = v.camera.pickEllipsoid(new Cartesian2(x1, y), ell);
  if (!a || !b) return null;
  const g = new EllipsoidGeodesic(Cartographic.fromCartesian(a), Cartographic.fromCartesian(b));
  const mPerPx = g.surfaceDistance / 100;
  if (!(mPerPx > 0) || !Number.isFinite(mPerPx)) return null;
  let best = NICE_M[0];
  for (const m of NICE_M) {
    if (m / mPerPx <= MAX_BAR_PX) best = m;
  }
  return { label: formatDist(best), widthPx: Math.max(28, Math.round(best / mPerPx)) };
}

/** Scale bar for the globe — updates as the camera moves. */
export default function MapScale({ getViewer }: { getViewer: () => Viewer | null }) {
  const [bar, setBar] = useState<{ label: string; widthPx: number } | null>(null);

  useEffect(() => {
    let remove: (() => void) | undefined;
    let removeMove: (() => void) | undefined;
    let tries = 0;
    let timer = 0;
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const v = getViewer();
        if (!v || v.isDestroyed()) return;
        setBar(measure(v));
      }, 80);
    };
    const attach = () => {
      const v = getViewer();
      if (!v) {
        if (tries++ < 60) requestAnimationFrame(attach);
        return;
      }
      sync();
      remove = v.camera.changed.addEventListener(sync);
      removeMove = v.camera.moveEnd.addEventListener(sync);
    };
    attach();
    return () => {
      window.clearTimeout(timer);
      remove?.();
      removeMove?.();
    };
  }, [getViewer]);

  if (!bar) return null;

  return (
    <div className="map-scale glass" aria-label={`Map scale ${bar.label}`}>
      <div className="map-scale-bar" style={{ width: bar.widthPx }} />
      <span>{bar.label}</span>
    </div>
  );
}
