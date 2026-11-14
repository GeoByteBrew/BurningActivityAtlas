import { anomalyGradientCss, divergeGradientCss, fireGradientCss, SENSOR_COLORS } from "../colors";
import { fmt } from "../data";
import type { ColorMode, Layer, Sensor } from "../types";

export default function Legend({
  cell = "5 km",
  layer,
  sensor,
  colorMode,
  max,
  baseline,
}: {
  cell?: string;
  layer: Layer;
  sensor: Sensor;
  colorMode: ColorMode;
  max: number;
  baseline: string;
}) {
  if (layer === "points")
    return (
      <div className="legend glass">
        <span className="legend-title">Active fire detections</span>
        <div className="legend-points">
          {sensor !== "viirs" && (
            <span>
              <i style={{ background: SENSOR_COLORS.modis }} /> MODIS (1 km)
            </span>
          )}
          {sensor !== "modis" && (
            <span>
              <i style={{ background: SENSOR_COLORS.viirs }} /> VIIRS (375 m)
            </span>
          )}
        </div>
        <span className="legend-sub">Dot size = fire radiative power</span>
      </div>
    );

  if (sensor === "harm" && colorMode === "anomaly")
    return (
      <div className="legend glass">
        <span className="legend-title">Fire activity vs. normal</span>
        <div className="legend-bar" style={{ background: anomalyGradientCss }} />
        <div className="legend-scale">
          <span>0.25×</span>
          <span>0.5×</span>
          <span>normal</span>
          <span>2×</span>
          <span>4×+</span>
        </div>
        <span className="legend-sub">Normal = {baseline} average, same months · height = detections</span>
      </div>
    );

  const diff = sensor === "diff" || sensor === "convdiff";
  const conv = sensor === "convdiff";
  return (
    <div className="legend glass">
      <span className="legend-title">{conv ? "MODIS converted − VIIRS, per cell" : diff ? "Raw sensor difference: VIIRS − MODIS per cell" : `Detections per ${cell} cell`}</span>
      <div className="legend-bar" style={{ background: diff ? divergeGradientCss : fireGradientCss }} />
      <div className="legend-scale">
        {diff ? (
          <>
            <span>{conv ? "converted" : "MODIS"} +{fmt(max)}</span>
            <span>0</span>
            <span>VIIRS +{fmt(max)}</span>
          </>
        ) : (
          <>
            <span>1</span>
            <span>{fmt(Math.round(Math.sqrt(max)))}</span>
            <span>{fmt(max)}</span>
          </>
        )}
      </div>
      <span className="legend-sub">Column height and colour on a log scale</span>
    </div>
  );
}
