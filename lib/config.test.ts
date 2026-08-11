import { describe, it, expect } from 'vitest'
import { SPOTS, getSpot } from '@/config/spots'
import { nwsContact, nwsUserAgent } from './config'
import { loadLakePolygon } from './geometry'

describe('Dunmore spot', () => {
  const dunmore = getSpot('dunmore')

  it('is registered', () => {
    expect(dunmore).toBeDefined()
  })

  it('encodes the approved gate thresholds', () => {
    expect(dunmore!.wind).toEqual({
      minKt: 5,
      maxKt: 20,
      maxGustKt: 30,
    })
    expect(dunmore!.precip.maxProbability).toBe(30)
    expect(dunmore!.window.minHours).toBe(3)
  })

  it('runs May 1 through November 1', () => {
    expect(dunmore!.season.start).toEqual({ month: 5, day: 1 })
    expect(dunmore!.season.end).toEqual({ month: 11, day: 1 })
  })
})

describe('NWS contact', () => {
  it('throws a clear error naming NWS_CONTACT when it is unset', () => {
    const prev = process.env.NWS_CONTACT
    delete process.env.NWS_CONTACT
    expect(() => nwsContact()).toThrow(/NWS_CONTACT/)
    if (prev !== undefined) process.env.NWS_CONTACT = prev
  })

  it('builds a User-Agent with an app id and the contact', () => {
    const prev = process.env.NWS_CONTACT
    process.env.NWS_CONTACT = 'unit-test@example.com'
    const ua = nwsUserAgent()
    expect(ua).toContain('sail-window-app')
    expect(ua).toContain('unit-test@example.com')
    if (prev === undefined) delete process.env.NWS_CONTACT
    else process.env.NWS_CONTACT = prev
  })
})

describe('forecast point placement', () => {
  // Regression guard. The original Dunmore point (43.885, -73.085) was on land
  // southwest of the lake and resolved to a different NWS grid cell. Runs over
  // every spot that declares an outline, so a new spot with a bad coordinate is
  // caught the same way.
  const outlined = SPOTS.filter((s) => s.outline)

  it('has at least one outlined spot to check', () => {
    expect(outlined.length).toBeGreaterThan(0)
  })

  for (const spot of outlined) {
    it(`places ${spot.name}'s forecast point inside its outline, not on the shore`, () => {
      const ring = loadLakePolygon(spot.outline)
      expect(ring).not.toBeNull()
      const { lat, lon } = spot
      let inside = false
      for (let i = 0; i < ring!.length - 1; i++) {
        const [x1, y1] = ring![i]
        const [x2, y2] = ring![i + 1]
        if (y1 > lat !== y2 > lat) {
          const xInt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)
          if (lon < xInt) inside = !inside
        }
      }
      expect(inside).toBe(true)
    })
  }
})
