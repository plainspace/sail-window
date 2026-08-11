import { describe, it, expect } from 'vitest'
import { CONFIG } from './config'
import { loadLakePolygon } from './geometry'

describe('CONFIG', () => {
  it('encodes the approved gate thresholds', () => {
    expect(CONFIG.wind).toEqual({ minKt: 7, maxKt: 20, maxGustKt: 30 })
    expect(CONFIG.precip.maxProbability).toBe(30)
    expect(CONFIG.window.minHours).toBe(3)
  })

  it('runs May 1 through November 1', () => {
    expect(CONFIG.season.start).toEqual({ month: 5, day: 1 })
    expect(CONFIG.season.end).toEqual({ month: 11, day: 1 })
  })

  it('points at the verified BTV gridpoint', () => {
    expect(CONFIG.nws.gridpointUrl).toBe('https://api.weather.gov/gridpoints/BTV/97,31')
    expect(CONFIG.nws.userAgent).toContain('dunmore-sailing-app')
  })

  it('places the forecast point inside the lake, not on the shore', () => {
    // Regression guard. The original point (43.885, -73.085) was on land
    // southwest of the lake and resolved to a different NWS grid cell.
    const ring = loadLakePolygon()
    const { lat, lon } = CONFIG.location
    let inside = false
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[i + 1]
      if (y1 > lat !== y2 > lat) {
        const xInt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)
        if (lon < xInt) inside = !inside
      }
    }
    expect(inside).toBe(true)
  })
})
