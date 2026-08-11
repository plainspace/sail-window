import { judge, type FailReason } from './rules'
import type { HourlyConditions } from './nws'
import type { Spot } from '@/config/spots'

export type SailWindow = {
  start: string
  end: string
  hours: number
  windKtMin: number
  windKtMax: number
  directions: string[]
  temperatureFAvg: number
  hasUnknownGust: boolean
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
function runs<T>(items: T[], key: (t: T) => string | null, minHours: number): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let curKey: string | null = null
  for (const it of items) {
    const k = key(it)
    if (k !== null && k === curKey) cur.push(it)
    else {
      if (cur.length >= minHours) out.push(cur)
      cur = k === null ? [] : [it]
      curKey = k
    }
  }
  if (cur.length >= minHours) out.push(cur)
  return out
}

export function buildWindows(hours: HourlyConditions[], spot: Spot): SailWindow[] {
  return runs(hours, (h) => (judge(h, spot).pass ? 'pass' : null), spot.window.minHours).map((group) => {
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
    }
  })
}

function marginFor(reason: FailReason, h: HourlyConditions, spot: Spot): string {
  switch (reason) {
    case 'wind-too-light':
      return `${(spot.wind.minKt - h.windKt).toFixed(1)} kt short`
    case 'wind-too-strong':
      return `${(h.windKt - spot.wind.maxKt).toFixed(1)} kt over`
    case 'gusty':
      return `gusts ${Math.round(h.gustKt ?? 0)} kt`
    case 'precip':
      return `precip ${Math.round(h.precipProbability)}%`
    default:
      return ''
  }
}

/** The hour in a near-miss run that came nearest to clearing the gate it failed. */
function closestHour(reason: FailReason, group: HourlyConditions[], spot: Spot): HourlyConditions {
  const distance = (h: HourlyConditions): number => {
    switch (reason) {
      case 'wind-too-light':
        return spot.wind.minKt - h.windKt
      case 'wind-too-strong':
        return h.windKt - spot.wind.maxKt
      case 'gusty':
        return (h.gustKt ?? 0) - spot.wind.maxGustKt
      case 'precip':
        return h.precipProbability - spot.precip.maxProbability
      default:
        return 0
    }
  }
  return group.reduce((best, h) => (distance(h) < distance(best) ? h : best), group[0])
}

/** Runs of hours that failed exactly one gate, and the same gate throughout. */
export function buildNearMisses(hours: HourlyConditions[], spot: Spot): NearMiss[] {
  const soleReason = (h: HourlyConditions): string | null => {
    const v = judge(h, spot)
    if (v.pass) return null
    if (v.reasons.length !== 1) return null
    // Darkness and the season are facts about the calendar, not near misses. "You could
    // have sailed Tuesday night if it were not night" is noise, and it shows up as soon
    // as the wind floor is low enough for night hours to clear every other gate.
    if (v.reasons[0] === 'dark' || v.reasons[0] === 'off-season') return null
    return v.reasons[0]
  }
  return runs(hours, soleReason, spot.window.minHours).map((group) => {
    const reason = soleReason(group[0]) as FailReason
    return {
      start: group[0].startTime,
      end: endOf(group[group.length - 1]),
      hours: group.length,
      reason,
      // Report the margin from the CLOSEST hour in the run, not the first. A day
      // that peaks 0.2 kt under the floor is the most interesting near miss there
      // is, and reporting its 6am hour instead made it look hopeless.
      margin: marginFor(reason, closestHour(reason, group, spot), spot),
    }
  })
}
