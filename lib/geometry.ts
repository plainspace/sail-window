import lake from '../data/lake-dunmore.json'

export type LatLon = [number, number] // [lon, lat], GeoJSON order

// Imported rather than read with fs on purpose. A runtime path built from
// process.cwd() is not traced into a serverless bundle, so the file goes
// missing in production while working perfectly in local dev.
export function loadLakePolygon(): LatLon[] {
  return lake.geometry.coordinates[0] as LatLon[]
}
