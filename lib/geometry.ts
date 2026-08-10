import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config'

export type LatLon = [number, number] // [lon, lat], GeoJSON order

let cached: LatLon[] | null = null

export function loadLakePolygon(): LatLon[] {
  if (cached) return cached
  const file = path.resolve(process.cwd(), 'data/lake-dunmore.geojson')
  const gj = JSON.parse(readFileSync(file, 'utf8'))
  cached = gj.geometry.coordinates[0] as LatLon[]
  return cached
}

/** Equirectangular projection to metres, accurate enough over a 3 mile lake. */
function toMeters(poly: LatLon[]): [number, number][] {
  const R = 6371000
  const lat0 = (CONFIG.location.lat * Math.PI) / 180
  return poly.map(([lon, lat]) => [
    ((lon * Math.PI) / 180) * R * Math.cos(lat0),
    ((lat * Math.PI) / 180) * R,
  ])
}

/** Total length of polygon interior along one infinite line, via crossings. */
function chordOnLine(
  pts: [number, number][],
  origin: [number, number],
  dir: [number, number],
): number {
  const [dx, dy] = dir
  // Perpendicular offset of each vertex from the line, and along-line coordinate.
  const ts: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const sa = (a[0] - origin[0]) * -dy + (a[1] - origin[1]) * dx
    const sb = (b[0] - origin[0]) * -dy + (b[1] - origin[1]) * dx
    if (sa === sb) continue
    if (sa > 0 === sb > 0) continue // no crossing
    const f = sa / (sa - sb)
    const px = a[0] + (b[0] - a[0]) * f
    const py = a[1] + (b[1] - a[1]) * f
    ts.push((px - origin[0]) * dx + (py - origin[1]) * dy)
  }
  if (ts.length < 2) return 0
  ts.sort((m, n) => m - n)
  // Pair crossings: inside spans are between successive pairs.
  let total = 0
  for (let i = 0; i + 1 < ts.length; i += 2) total += ts[i + 1] - ts[i]
  return total
}

/**
 * Maximum over-water fetch along the given bearing, in metres.
 * A fetch line is an axis, so bearing and bearing+180 give the same answer.
 */
export function fetchMeters(bearingDeg: number, polygon?: LatLon[]): number {
  const pts = toMeters(polygon ?? loadLakePolygon())
  const rad = (((bearingDeg % 360) + 360) % 360) * (Math.PI / 180)
  // Bearing 0 = north = +y. Bearing 90 = east = +x.
  const dir: [number, number] = [Math.sin(rad), Math.cos(rad)]
  const perp: [number, number] = [-dir[1], dir[0]]

  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
  const offsets = pts.map((p) => (p[0] - cx) * perp[0] + (p[1] - cy) * perp[1])
  const lo = Math.min(...offsets)
  const hi = Math.max(...offsets)

  // Sample parallel lines across the lake; keep the longest water crossing.
  const SAMPLES = 200
  let best = 0
  for (let i = 1; i < SAMPLES; i++) {
    const off = lo + ((hi - lo) * i) / SAMPLES
    const origin: [number, number] = [cx + perp[0] * off, cy + perp[1] * off]
    best = Math.max(best, chordOnLine(pts, origin, dir))
  }
  return best
}
