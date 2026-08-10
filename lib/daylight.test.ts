import { describe, it, expect } from 'vitest'
import { sunTimes, isDaylight } from './daylight'

describe('sunTimes', () => {
  it('matches the sunrise and sunset NWS reported for 2026-08-10', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-08-10T12:00:00Z'))
    const nwsSunrise = Date.parse('2026-08-10T05:51:08-04:00')
    const nwsSunset = Date.parse('2026-08-10T20:04:14-04:00')
    // Within two minutes of the official value.
    expect(Math.abs(sunrise.getTime() - nwsSunrise)).toBeLessThan(120_000)
    expect(Math.abs(sunset.getTime() - nwsSunset)).toBeLessThan(120_000)
  })
})

describe('isDaylight', () => {
  it('accepts midday and rejects the small hours', () => {
    expect(isDaylight('2026-08-10T16:00:00Z')).toBe(true)  // noon ET
    expect(isDaylight('2026-08-10T07:00:00Z')).toBe(false) // 3am ET
  })

  it('rejects an hour just before sunrise and accepts one just after', () => {
    expect(isDaylight('2026-08-10T09:00:00Z')).toBe(false) // 5am ET
    expect(isDaylight('2026-08-10T11:00:00Z')).toBe(true)  // 7am ET
  })
})
