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

// A window that clears every gate except sustained wind, but sits close enough to the
// floor with enough gust to be genuinely sailable with lulls. Same summary shape as a
// SailWindow, plus the gust range and peakKt... the peak sustained wind, which is the
// number the sailor actually judges the day by.
export type MarginalWindow = {
  start: string
  end: string
  hours: number
  windKtMin: number
  windKtMax: number
  peakKt: number
  gustKtMin: number
  gustKtMax: number
  directions: string[]
  temperatureFAvg: number
  hasUnknownGust: boolean
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

/**
 * An hour is marginal when it fails ONLY the wind-too-light gate (every other gate
 * passes), its sustained wind holds at spot.wind.marginalMinKt or above (and below
 * minKt, which wind-too-light already guarantees), and its gust clears
 * spot.wind.marginalGustKt. A null gust is unknown, not a gust, so it never qualifies.
 */
function isMarginalHour(h: HourlyConditions, spot: Spot): boolean {
  const v = judge(h, spot)
  if (v.pass) return false
  if (v.reasons.length !== 1 || v.reasons[0] !== 'wind-too-light') return false
  if (h.windKt < spot.wind.marginalMinKt) return false
  return h.gustKt !== null && h.gustKt > spot.wind.marginalGustKt
}

/** Runs of marginal hours (see isMarginalHour), summarised like a SailWindow. */
export function buildMarginalWindows(hours: HourlyConditions[], spot: Spot): MarginalWindow[] {
  return runs(hours, (h) => (isMarginalHour(h, spot) ? 'marginal' : null), spot.window.minHours).map(
    (group) => {
      // Every hour in a marginal run cleared the gust threshold, so gustKt is never null
      // here and the range is always two real numbers.
      const gusts = group.map((h) => h.gustKt as number)
      const winds = group.map((h) => h.windKt)
      return {
        start: group[0].startTime,
        end: endOf(group[group.length - 1]),
        hours: group.length,
        windKtMin: Math.min(...winds),
        windKtMax: Math.max(...winds),
        peakKt: Math.max(...winds),
        gustKtMin: Math.min(...gusts),
        gustKtMax: Math.max(...gusts),
        directions: [...new Set(group.map((h) => h.windDirection))],
        temperatureFAvg:
          Math.round(group.reduce((s, h) => s + h.temperatureF, 0) / group.length),
        hasUnknownGust: false,
      }
    }
  )
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
    // One day, one verdict. An hour that qualifies as marginal is reported there, so it
    // must not also count toward a near-miss run... it drops out of the stream entirely.
    if (isMarginalHour(h, spot)) return null
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
