import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseOpenMeteo } from './openmeteo'

const fixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../tests/fixtures/openmeteo-dunmore-2026-08-11.json'),
    'utf8',
  ),
)

describe('parseOpenMeteo', () => {
  const hours = parseOpenMeteo(fixture)

  it('reads the parallel hourly arrays into dense rows', () => {
    expect(hours.length).toBeGreaterThan(150)
  })

  it('produces strictly increasing, gapless hourly timestamps', () => {
    for (let i = 1; i < hours.length; i++) {
      const prev = Date.parse(hours[i - 1].startTime)
      const cur = Date.parse(hours[i].startTime)
      expect(cur - prev).toBe(3600_000)
    }
  })

  it('emits millisecond-precision UTC ISO timestamps matching the NWS format', () => {
    for (const h of hours) {
      expect(h.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    }
  })

  it('keeps wind in knots without re-converting (wind_speed_unit=kn)', () => {
    // Fixture wind_speed_10m[0] is already knots and must pass through untouched.
    expect(hours[0].windKt).toBeCloseTo(fixture.hourly.wind_speed_10m[0], 5)
  })

  it('keeps temperature in Fahrenheit without re-converting (temperature_unit=fahrenheit)', () => {
    expect(hours[0].temperatureF).toBeCloseTo(fixture.hourly.temperature_2m[0], 5)
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

  it('maps cloud_cover to skyCoverPct as a percentage', () => {
    const withSky = hours.filter((h) => h.skyCoverPct !== null)
    expect(withSky.length).toBeGreaterThan(0)
    for (const h of withSky) {
      expect(h.skyCoverPct).toBeGreaterThanOrEqual(0)
      expect(h.skyCoverPct).toBeLessThanOrEqual(100)
    }
  })

  it('represents a missing gust as null, never coerced to a number', () => {
    for (const h of hours) {
      expect(h.gustKt === null || typeof h.gustKt === 'number').toBe(true)
    }
  })

  it('preserves a genuine zero gust as 0, distinct from missing', () => {
    const synthetic = {
      hourly: {
        time: ['2026-08-15T12:00'],
        wind_speed_10m: [10],
        wind_gusts_10m: [0],
        wind_direction_10m: [180],
        precipitation_probability: [5],
        cloud_cover: [40],
        temperature_2m: [70],
      },
    }
    const rows = parseOpenMeteo(synthetic)
    expect(rows).toHaveLength(1)
    expect(rows[0].gustKt).toBe(0)
  })

  it('yields a null gust when the gust value for an hour is null', () => {
    const synthetic = {
      hourly: {
        time: ['2026-08-15T12:00', '2026-08-15T13:00'],
        wind_speed_10m: [10, 12],
        wind_gusts_10m: [18, null],
        wind_direction_10m: [180, 190],
        precipitation_probability: [5, 5],
        cloud_cover: [40, 50],
        temperature_2m: [70, 71],
      },
    }
    const rows = parseOpenMeteo(synthetic)
    expect(rows).toHaveLength(2)
    expect(rows[0].gustKt).toBe(18)
    expect(rows[1].gustKt).toBeNull()
  })

  it('drops an hour missing wind, direction or temperature rather than guessing', () => {
    const synthetic = {
      hourly: {
        time: ['2026-08-15T12:00', '2026-08-15T13:00', '2026-08-15T14:00'],
        wind_speed_10m: [10, null, 12],
        wind_gusts_10m: [18, 20, 22],
        wind_direction_10m: [180, 190, null],
        precipitation_probability: [5, 5, 5],
        cloud_cover: [40, 50, 60],
        temperature_2m: [70, 71, 72],
      },
    }
    const rows = parseOpenMeteo(synthetic)
    // Only the first hour is complete; the second lacks wind, the third lacks direction.
    expect(rows).toHaveLength(1)
    expect(rows[0].windKt).toBe(10)
  })

  it('treats a null precip probability as zero rather than dropping the hour', () => {
    const synthetic = {
      hourly: {
        time: ['2026-08-15T12:00'],
        wind_speed_10m: [10],
        wind_gusts_10m: [18],
        wind_direction_10m: [180],
        precipitation_probability: [null],
        cloud_cover: [40],
        temperature_2m: [70],
      },
    }
    const rows = parseOpenMeteo(synthetic)
    expect(rows).toHaveLength(1)
    expect(rows[0].precipProbability).toBe(0)
  })

  it('yields a null sky cover for input that omits cloud_cover, without dropping the hour', () => {
    const synthetic = {
      hourly: {
        time: ['2026-08-15T12:00'],
        wind_speed_10m: [10],
        wind_gusts_10m: [18],
        wind_direction_10m: [180],
        precipitation_probability: [5],
        temperature_2m: [70],
      },
    }
    const rows = parseOpenMeteo(synthetic)
    expect(rows).toHaveLength(1)
    expect(rows[0].skyCoverPct).toBeNull()
  })

  it('throws when the response has no hourly.time array', () => {
    expect(() => parseOpenMeteo({})).toThrow()
    expect(() => parseOpenMeteo({ hourly: {} })).toThrow()
  })
})
