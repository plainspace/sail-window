import { describe, it, expect } from 'vitest'
import { judge, inSeason } from './rules'
import { getSpot } from '@/config/spots'
import type { HourlyConditions } from './nws'

const spot = getSpot('dunmore')!

// 2026-08-15T16:00:00Z is noon ET, in season, in daylight.
const base: HourlyConditions = {
  startTime: '2026-08-15T16:00:00Z',
  windKt: 12,
  gustKt: 18,
  windDirectionDeg: 180,
  windDirection: 'S',
  precipProbability: 5,
  temperatureF: 75,
  skyCoverPct: 40,
}
const at = (over: Partial<HourlyConditions>) => judge({ ...base, ...over }, spot)

describe('wind gates', () => {
  it('accepts the inclusive bounds', () => {
    expect(at({ windKt: 5 }).pass).toBe(true)
    expect(at({ windKt: 20 }).pass).toBe(true)
  })

  it('rejects just outside the bounds with the right reason', () => {
    expect(at({ windKt: 4.9 })).toEqual({ pass: false, reasons: ['wind-too-light'] })
    expect(at({ windKt: 20.1 })).toEqual({ pass: false, reasons: ['wind-too-strong'] })
  })
})

describe('gust gate', () => {
  it('accepts exactly 25 and rejects 26', () => {
    expect(at({ gustKt: 25 }).pass).toBe(true)
    expect(at({ gustKt: 26 })).toEqual({ pass: false, reasons: ['gusty'] })
  })

  it('never vetoes on a null gust', () => {
    expect(at({ gustKt: null }).pass).toBe(true)
  })
})

describe('precip gate', () => {
  it('is strictly less than the threshold', () => {
    expect(at({ precipProbability: 29 }).pass).toBe(true)
    expect(at({ precipProbability: 30 })).toEqual({ pass: false, reasons: ['precip'] })
  })
})

describe('reason collection', () => {
  it('reports every failing gate, not just the first', () => {
    const v = at({ windKt: 2, precipProbability: 90 })
    expect(v.pass).toBe(false)
    if (!v.pass) {
      expect(v.reasons).toContain('wind-too-light')
      expect(v.reasons).toContain('precip')
    }
  })
})

describe('season', () => {
  it('includes both boundary days', () => {
    expect(inSeason('2026-05-01T16:00:00Z', spot)).toBe(true)
    expect(inSeason('2026-11-01T16:00:00Z', spot)).toBe(true)
  })

  it('excludes the days outside', () => {
    expect(inSeason('2026-04-30T16:00:00Z', spot)).toBe(false)
    expect(inSeason('2026-11-02T16:00:00Z', spot)).toBe(false)
  })

  it('rejects a perfect January afternoon on the frozen lake', () => {
    const v = judge({ ...base, startTime: '2026-01-15T17:00:00Z', temperatureF: 34 }, spot)
    expect(v.pass).toBe(false)
    if (!v.pass) expect(v.reasons).toContain('off-season')
  })
})

describe('daylight', () => {
  it('rejects the middle of the night', () => {
    const v = judge({ ...base, startTime: '2026-08-15T07:00:00Z' }, spot)
    expect(v.pass).toBe(false)
    if (!v.pass) expect(v.reasons).toContain('dark')
  })
})
