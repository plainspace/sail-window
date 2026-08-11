import { describe, it, expect } from 'vitest'
import { buildWindows, buildNearMisses, buildMarginalWindows } from './windows'
import { getSpot } from '@/config/spots'
import type { HourlyConditions } from './nws'

const spot = getSpot('dunmore')!

const HOUR = 3600_000
// 2026-08-15T14:00:00Z is 10am ET, safely inside daylight and season.
const START = Date.parse('2026-08-15T14:00:00Z')

function run(n: number, over: Partial<HourlyConditions> = {}, offset = 0): HourlyConditions[] {
  return Array.from({ length: n }, (_, i) => ({
    startTime: new Date(START + (i + offset) * HOUR).toISOString(),
    windKt: 12,
    gustKt: 18,
    windDirectionDeg: 180,
    windDirection: 'S',
    precipProbability: 5,
    temperatureF: 75,
    skyCoverPct: 40,
    ...over,
  }))
}

describe('buildWindows', () => {
  it('keeps a three-hour run', () => {
    const w = buildWindows(run(3), spot)
    expect(w).toHaveLength(1)
    expect(w[0].hours).toBe(3)
  })

  it('discards a two-hour run', () => {
    expect(buildWindows(run(2), spot)).toHaveLength(0)
  })

  it('splits on a failing hour rather than bridging it', () => {
    const hours = [...run(3), ...run(1, { windKt: 2 }, 3), ...run(3, {}, 4)]
    const w = buildWindows(hours, spot)
    expect(w).toHaveLength(2)
  })

  it('summarises wind range, directions, and temperature', () => {
    const hours = [
      ...run(1, { windKt: 9, windDirection: 'S' }),
      ...run(1, { windKt: 15, windDirection: 'SW' }, 1),
      ...run(1, { windKt: 12, windDirection: 'S' }, 2),
    ]
    const [w] = buildWindows(hours, spot)
    expect(w.windKtMin).toBe(9)
    expect(w.windKtMax).toBe(15)
    expect(w.directions).toEqual(['S', 'SW'])
    expect(w.temperatureFAvg).toBe(75)
  })

  it('flags a window containing an hour with an unknown gust', () => {
    const hours = [...run(2), ...run(1, { gustKt: null }, 2)]
    expect(buildWindows(hours, spot)[0].hasUnknownGust).toBe(true)
  })

  it('returns nothing when nothing qualifies', () => {
    expect(buildWindows(run(12, { windKt: 2 }), spot)).toEqual([])
  })
})

describe('buildNearMisses', () => {
  it('reports a run that failed exactly one gate', () => {
    const misses = buildNearMisses(run(4, { precipProbability: 35 }), spot)
    expect(misses).toHaveLength(1)
    expect(misses[0].reason).toBe('precip')
    expect(misses[0].hours).toBe(4)
    expect(misses[0].margin).toContain('35')
  })

  it('ignores a run that failed two gates', () => {
    expect(buildNearMisses(run(4, { precipProbability: 35, windKt: 2 }), spot)).toEqual([])
  })

  it('ignores a near-miss run shorter than the minimum', () => {
    expect(buildNearMisses(run(2, { precipProbability: 35 }), spot)).toEqual([])
  })

  it('does not report hours that actually qualify', () => {
    expect(buildNearMisses(run(5), spot)).toEqual([])
  })

  it('does not report a run that qualifies as marginal', () => {
    // 4.5 kt gusting 13.8: fails only wind-too-light, clears the marginal thresholds.
    const hours = run(5, { windKt: 4.5, gustKt: 13.8 })
    expect(buildMarginalWindows(hours, spot)).toHaveLength(1)
    expect(buildNearMisses(hours, spot)).toEqual([])
  })
})

describe('buildMarginalWindows', () => {
  it('qualifies a run at 4.5 kt gusting 13.8', () => {
    const m = buildMarginalWindows(run(5, { windKt: 4.5, gustKt: 13.8 }), spot)
    expect(m).toHaveLength(1)
    expect(m[0].hours).toBe(5)
    expect(m[0].peakKt).toBeCloseTo(4.5)
    expect(m[0].gustKtMax).toBeCloseTo(13.8)
  })

  it('does not qualify the same run gusting only 4', () => {
    expect(buildMarginalWindows(run(5, { windKt: 6.8, gustKt: 4 }), spot)).toEqual([])
  })

  it('does not qualify a run at 3.5 kt, below the marginal floor', () => {
    expect(buildMarginalWindows(run(5, { windKt: 3.5, gustKt: 13.8 }), spot)).toEqual([])
  })

  it('does not qualify a two-hour run', () => {
    expect(buildMarginalWindows(run(2, { windKt: 4.5, gustKt: 13.8 }), spot)).toEqual([])
  })

  it('does not qualify a run that also fails another gate', () => {
    // Wind marginal, but precip over the gate too... more than one failing gate.
    expect(
      buildMarginalWindows(run(5, { windKt: 6.8, gustKt: 13.8, precipProbability: 35 }), spot)
    ).toEqual([])
  })
})
