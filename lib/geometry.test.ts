import { describe, it, expect } from 'vitest'
import { loadLakePolygon, fetchMeters } from './geometry'

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

describe('fetchMeters', () => {
  const northSouth = fetchMeters(0)
  const eastWest = fetchMeters(90)

  it('gives a longer fetch along the lake axis than across it', () => {
    expect(northSouth).toBeGreaterThan(eastWest * 2)
  })

  it('returns a plausible magnitude for a three-mile lake', () => {
    expect(northSouth).toBeGreaterThan(1500)
    expect(northSouth).toBeLessThan(8000)
  })

  it('is direction-agnostic, since a fetch line is an axis', () => {
    expect(fetchMeters(0)).toBeCloseTo(fetchMeters(180), 0)
    expect(fetchMeters(90)).toBeCloseTo(fetchMeters(270), 0)
  })

  it('handles wrapped and negative bearings', () => {
    expect(fetchMeters(360)).toBeCloseTo(fetchMeters(0), 0)
    expect(fetchMeters(-90)).toBeCloseTo(fetchMeters(270), 0)
  })
})
