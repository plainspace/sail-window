import lakeDunmore from '../data/lake-dunmore.json'

export type LatLon = [number, number] // [lon, lat], GeoJSON order

type OutlineFeature = { geometry: { coordinates: number[][][] } }

// Outlines are imported statically, never read from disk at runtime. A path built
// from process.cwd() is not traced into a serverless bundle, so the file goes
// missing in production while working perfectly in local dev. A new outline gets
// one line here alongside its file under data/.
const OUTLINES: Record<string, OutlineFeature> = {
  'lake-dunmore.json': lakeDunmore as OutlineFeature,
}

// The outline is optional. Returns null when a spot declares none, or names a file
// that is not registered above, so callers render fine without a silhouette.
export function loadLakePolygon(outline?: string): LatLon[] | null {
  if (!outline) return null
  const feature = OUTLINES[outline]
  if (!feature) return null
  return feature.geometry.coordinates[0] as LatLon[]
}
