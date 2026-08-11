import { CONFIG } from './config'
import { judge, type FailReason } from './rules'
import { fetchMeters } from './geometry'
import type { HourlyConditions } from './nws'

export type SailWindow = {
  start: string
  end: string
  hours: number
  windKtMin: number
  windKtMax: number
  directions: string[]
  temperatureFAvg: number
  hasUnknownGust: boolean
  fetchMetersMin: number
  fetchMetersMax: number
}

export type NearMiss = {
  start: string
  end: string
  hours: number
  reason: FailReason
  margin: string
}

const HOUR_MS = 3600_000
const endOf = (h: HourlyConditions) => new Date(Date.parse(h.startTime) + HOUR_MS).toISOString()

/** Group consecutive hours sharing a key, discarding groups below minHours. */
function runs<T>(items: T[], key: (t: T) => string | null): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let curKey: string | null = null
  for (const it of items) {
    const k = key(it)
    if (k !== null && k === curKey) cur.push(it)
    else {
      if (cur.length >= CONFIG.window.minHours) out.push(cur)
      cur = k === null ? [] : [it]
      curKey = k
    }
  }
  if (cur.length >= CONFIG.window.minHours) out.push(cur)
  return out
}

export function buildWindows(hours: HourlyConditions[]): SailWindow[] {
  return runs(hours, (h) => (judge(h).pass ? 'pass' : null)).map((group) => {
    const fetches = group.map((h) => fetchMeters(h.windDirectionDeg))
    return {
      start: group[0].startTime,
      end: endOf(group[group.length - 1]),
      hours: group.length,
      windKtMin: Math.min(...group.map((h) => h.windKt)),
      windKtMax: Math.max(...group.map((h) => h.windKt)),
      directions: [...new Set(group.map((h) => h.windDirection))],
      temperatureFAvg:
        Math.round(group.reduce((s, h) => s + h.temperatureF, 0) / group.length),
      hasUnknownGust: group.some((h) => h.gustKt === null),
      fetchMetersMin: Math.round(Math.min(...fetches)),
      fetchMetersMax: Math.round(Math.max(...fetches)),
    }
  })
}

function marginFor(reason: FailReason, h: HourlyConditions): string {
  switch (reason) {
    case 'wind-too-light':
      return `${(CONFIG.wind.minKt - h.windKt).toFixed(1)} kt short`
    case 'wind-too-strong':
      return `${(h.windKt - CONFIG.wind.maxKt).toFixed(1)} kt over`
    case 'gusty':
      return `gusts ${Math.round(h.gustKt ?? 0)} kt`
    case 'precip':
      return `precip ${Math.round(h.precipProbability)}%`
    default:
      return ''
  }
}

/** Runs of hours that failed exactly one gate, and the same gate throughout. */
export function buildNearMisses(hours: HourlyConditions[]): NearMiss[] {
  const soleReason = (h: HourlyConditions): string | null => {
    const v = judge(h)
    if (v.pass) return null
    return v.reasons.length === 1 ? v.reasons[0] : null
  }
  return runs(hours, soleReason).map((group) => {
    const reason = soleReason(group[0]) as FailReason
    return {
      start: group[0].startTime,
      end: endOf(group[group.length - 1]),
      hours: group.length,
      reason,
      margin: marginFor(reason, group[0]),
    }
  })
}
