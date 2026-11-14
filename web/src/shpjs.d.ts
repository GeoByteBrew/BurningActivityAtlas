declare module "shpjs" {
  /** Zipped Shapefile (or .shp buffer) → GeoJSON in WGS84 (reprojected from the .prj when present). */
  export default function shp(input: ArrayBuffer | string): Promise<unknown>;
}
