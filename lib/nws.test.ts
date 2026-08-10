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

  it('represents a missing gust as null, never as zero', () => {
    for (const h of hours) {
      expect(h.gustKt === null || h.gustKt > 0).toBe(true)
    }
  })

  it('joins properties on the hour rather than by position', () => {
    // windSpeed has 67 entries and windGust has 102 in this fixture.
    // A positional zip would misalign; an hour-keyed join cannot.
    const gusty = hours.filter((h) => h.gustKt !== null)
    expect(gusty.length).toBeGreaterThan(50)
  })
})
