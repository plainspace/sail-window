import type { LatLon } from './geometry'

export function projectToSvg(poly: LatLon[], width: number, height: number) {
  const lons = poly.map((p) => p[0])
  const lats = poly.map((p) => p[1])
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const pad = 8
  const sx = (width - pad * 2) / (maxLon - minLon)
  const sy = (height - pad * 2) / (maxLat - minLat)
  const s = Math.min(sx, sy)
  const ox = pad + ((width - pad * 2) - (maxLon - minLon) * s) / 2
  const oy = pad + ((height - pad * 2) - (maxLat - minLat) * s) / 2

  const project = ([lon, lat]: LatLon): [number, number] => [
    ox + (lon - minLon) * s,
    oy + (maxLat - lat) * s, // north up
  ]

  const path =
    poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${project(p).map((n) => n.toFixed(1)).join(',')}`).join('') + 'Z'

  return { path, project }
}
