import { describe, it, expect } from 'vitest'
import { buildWindows, buildNearMisses, windPhrase, type SailWindow } from './windows'
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

  describe('gustKtMax', () => {
    it('reports the strongest gust in the window', () => {
      const hours = [...run(1, { gustKt: 14 }), ...run(1, { gustKt: 22 }, 1), ...run(1, { gustKt: 17 }, 2)]
      expect(buildWindows(hours, spot)[0].gustKtMax).toBe(22)
    })

    it('ignores unknown gusts rather than treating them as calm', () => {
      // An hour with no reading must not drag the maximum down to 0. If it did, a
      // single missing hour would silently make a gusty window look steady.
      const hours = [...run(1, { gustKt: 21 }), ...run(1, { gustKt: null }, 1), ...run(1, { gustKt: 12 }, 2)]
      const [w] = buildWindows(hours, spot)
      expect(w.gustKtMax).toBe(21)
      expect(w.hasUnknownGust).toBe(true)
    })

    it('is null when no hour reported a gust at all', () => {
      expect(buildWindows(run(3, { gustKt: null }), spot)[0].gustKtMax).toBeNull()
    })
  })
})

describe('windPhrase', () => {
  const win = (over: Partial<SailWindow> = {}): SailWindow => ({
    start: '2026-08-14T13:00:00.000Z',
    end: '2026-08-14T16:00:00.000Z',
    hours: 3,
    windKtMin: 7.1,
    windKtMax: 12.5,
    gustKtMax: 22,
    directions: ['NNW', 'N'],
    temperatureFAvg: 74,
    hasUnknownGust: false,
    ...over,
  })

  it('names the gust when it exceeds the sustained maximum', () => {
    // The Friday that started all this: 12.5 kt sustained, 22 kt gusts. Reading
    // "7 to 13 kt" alone made it look chill.
    expect(windPhrase(win())).toBe('7 to 13 kt gusting 22, NNW/N')
  })

  it('stays quiet when the gust does not exceed the sustained maximum', () => {
    expect(windPhrase(win({ gustKtMax: 12 }))).toBe('7 to 13 kt, NNW/N')
  })

  it('stays quiet when the gust equals the rounded sustained maximum', () => {
    expect(windPhrase(win({ gustKtMax: 12.5 }))).toBe('7 to 13 kt, NNW/N')
  })

  it('stays quiet when no gust is known', () => {
    expect(windPhrase(win({ gustKtMax: null }))).toBe('7 to 13 kt, NNW/N')
  })

  it('rounds the gust the way it rounds the wind', () => {
    expect(windPhrase(win({ gustKtMax: 21.6 }))).toBe('7 to 13 kt gusting 22, NNW/N')
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
})
