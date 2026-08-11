import { readFileSync } from 'node:fs'
import path from 'node:path'

export type LatLon = [number, number] // [lon, lat], GeoJSON order

let cached: LatLon[] | null = null

export function loadLakePolygon(): LatLon[] {
  if (cached) return cached
  const file = path.resolve(process.cwd(), 'data/lake-dunmore.geojson')
  const gj = JSON.parse(readFileSync(file, 'utf8'))
  cached = gj.geometry.coordinates[0] as LatLon[]
  return cached
}
