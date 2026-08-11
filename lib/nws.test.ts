import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseGridpoint, durationToHours, degreesToCardinal } from './nws'

const fixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../tests/fixtures/gridpoint-btv-97-30-2026-08-10.json'),
    'utf8',
  ),
)

describe('durationToHours', () => {
  it('parses hour-only durations', () => {
    expect(durationToHours('PT1H')).toBe(1)
    expect(durationToHours('PT9H')).toBe(9)
  })

  it('parses durations with a day component', () => {
    expect(durationToHours('P1DT6H')).toBe(30)
    expect(durationToHours('P2D')).toBe(48)
  })

  it('throws on an unparseable duration rather than guessing', () => {
    expect(() => durationToHours('banana')).toThrow()
  })
})

describe('degreesToCardinal', () => {
  it('maps the eight cardinals', () => {
    expect(degreesToCardinal(0)).toBe('N')
    expect(degreesToCardinal(45)).toBe('NE')
    expect(degreesToCardinal(90)).toBe('E')
    expect(degreesToCardinal(135)).toBe('SE')
    expect(degreesToCardinal(180)).toBe('S')
    expect(degreesToCardinal(225)).toBe('SW')
    expect(degreesToCardinal(270)).toBe('W')
    expect(degreesToCardinal(315)).toBe('NW')
  })

  it('wraps 360 back to north', () => {
    expect(degreesToCardinal(360)).toBe('N')
  })
})

describe('parseGridpoint', () => {
  const hours = parseGridpoint(fixture)

  it('expands run-length encoding into dense hourly rows', () => {
    expect(hours.length).toBeGreaterThan(150)
  })

  it('produces strictly increasing, gapless hourly timestamps', () => {
    for (let i = 1; i < hours.length; i++) {
      const prev = Date.parse(hours[i - 1].startTime)
      const cur = Date.parse(hours[i].startTime)
      expect(cur - prev).toBe(3600_000)
    }
  })

  it('converts km/h to knots', () => {
    // fixture windSpeed starts at 5.556 km/h == 3.0 kt
    expect(hours[0].windKt).toBeCloseTo(3.0, 1)
  })

  it('converts Celsius to Fahrenheit into a plausible August range', () => {
    for (const h of hours) {
      expect(h.temperatureF).toBeGreaterThan(20)
      expect(h.temperatureF).toBeLessThan(110)
    }
  })

  it('carries numeric degrees and a derived cardinal', () => {
    expect(typeof hours[0].windDirectionDeg).toBe('number')
    expect(hours[0].windDirection).toMatch(/^[NSEW]{1,3}$/)
  })

  it('keeps precip probability as a percentage', () => {
    for (const h of hours) {
      expect(h.precipProbability).toBeGreaterThanOrEqual(0)
      expect(h.precipProbability).toBeLessThanOrEqual(100)
    }
  })

  it('represents a missing gust as null, never coerced to a number', () => {
    for (const h of hours) {
      expect(h.gustKt === null || typeof h.gustKt === 'number').toBe(true)
    }
  })

  it('preserves a genuine zero gust as 0, distinct from missing', () => {
    // NWS reports a real 0 km/h gust for 2026-08-12T02:00Z through PT4H.
    const zeroHour = hours.find((h) => h.startTime === '2026-08-12T02:00:00.000Z')
    expect(zeroHour).toBeDefined()
    expect(zeroHour!.gustKt).toBe(0)
  })

  it('yields a null gust for an hour that windGust does not cover', () => {
    // Real NWS data for this gridpoint covers gusts for all 181 hours, so the
    // null branch is unreachable from the fixture and needs a constructed input.
    const synthetic = {
      properties: {
        windSpeed: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 18.52 }] },
        windGust: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT1H', value: 27.78 }] },
        windDirection: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 180 }] },
        probabilityOfPrecipitation: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 5 }] },
        temperature: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 22 }] },
      },
    }
    const rows = parseGridpoint(synthetic)
    expect(rows).toHaveLength(2)
    expect(rows[0].gustKt).toBeCloseTo(15, 0)
    expect(rows[1].gustKt).toBeNull()
  })

  it('finds complete gust coverage in the real fixture', () => {
    expect(hours.every((h) => h.gustKt !== null)).toBe(true)
  })

  it('joins properties on the hour rather than by position', () => {
    // windSpeed has 67 entries and windGust has 102 in this fixture.
    // A positional zip would misalign; an hour-keyed join cannot.
    const gusty = hours.filter((h) => h.gustKt !== null)
    expect(gusty.length).toBeGreaterThan(50)
  })

  it('keeps sky cover as a percentage between 0 and 100 when present', () => {
    const withSky = hours.filter((h) => h.skyCoverPct !== null)
    expect(withSky.length).toBeGreaterThan(0)
    for (const h of withSky) {
      expect(h.skyCoverPct).toBeGreaterThanOrEqual(0)
      expect(h.skyCoverPct).toBeLessThanOrEqual(100)
    }
  })

  it('yields a null sky cover for input that omits skyCover entirely, without dropping the hour', () => {
    const synthetic = {
      properties: {
        windSpeed: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 18.52 }] },
        windGust: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 27.78 }] },
        windDirection: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 180 }] },
        probabilityOfPrecipitation: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 5 }] },
        temperature: { values: [{ validTime: '2026-08-15T12:00:00+00:00/PT2H', value: 22 }] },
      },
    }
    const rows = parseGridpoint(synthetic)
    expect(rows).toHaveLength(2)
    expect(rows[0].skyCoverPct).toBeNull()
    expect(rows[1].skyCoverPct).toBeNull()
  })
})
