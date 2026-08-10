import { describe, it, expect } from 'vitest'
import { CONFIG } from './config'

describe('CONFIG', () => {
  it('encodes the approved gate thresholds', () => {
    expect(CONFIG.wind).toEqual({ minKt: 7, maxKt: 20, maxGustKt: 30 })
    expect(CONFIG.precip.maxProbability).toBe(20)
    expect(CONFIG.window.minHours).toBe(3)
  })

  it('runs May 1 through November 1', () => {
    expect(CONFIG.season.start).toEqual({ month: 5, day: 1 })
    expect(CONFIG.season.end).toEqual({ month: 11, day: 1 })
  })

  it('points at the verified BTV gridpoint', () => {
    expect(CONFIG.nws.gridpointUrl).toBe('https://api.weather.gov/gridpoints/BTV/97,30')
    expect(CONFIG.nws.userAgent).toContain('dunmore-sailing-app')
  })
})
