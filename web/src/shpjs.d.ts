// AI disclosure: written with the assistance of an AI tool (large language model). See AI_USE.md.
declare module "shpjs" {
  /** Zipped Shapefile (or .shp buffer) → GeoJSON in WGS84 (reprojected from the .prj when present). */
  export default function shp(input: ArrayBuffer | string): Promise<unknown>;
}
