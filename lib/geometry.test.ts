import { describe, it, expect } from 'vitest'
import { loadLakePolygon } from './geometry'

const poly = loadLakePolygon()

describe('loadLakePolygon', () => {
  it('loads a closed ring with real vertices', () => {
    expect(poly.length).toBeGreaterThan(20)
    for (const [lon, lat] of poly) {
      expect(lon).toBeLessThan(-72.9)
      expect(lon).toBeGreaterThan(-73.2)
      expect(lat).toBeGreaterThan(43.8)
      expect(lat).toBeLessThan(44.0)
    }
  })
})
