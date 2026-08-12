import { judge, type FailReason } from './rules'
import type { HourlyConditions } from './nws'
import type { Spot } from '@/config/spots'

export type SailWindow = {
  start: string
  end: string
  hours: number
  windKtMin: number
  windKtMax: number
  /**
   * The strongest gust in the window, or null if no hour reported one.
   *
   * This exists because for a long time it did not, and its absence was the single
   * most misleading thing about the app. Gusts gated every window and then appeared
   * in exactly one place: the margin on a near miss, i.e. only when a gust was bad
   * enough to disqualify the day. Below the ceiling the number was invisible, so a
   * Friday of 11 kt sustained gusting 22 rendered as "7 to 13 kt" and read as chill.
   * The explainer had been making this exact argument in prose the whole time.
   */
  gustKtMax: number | null
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
      // Known gusts only. An hour with no gust reading is unknown, not calm, so it
      // must not drag the maximum down... hasUnknownGust flags that separately.
      gustKtMax: (() => {
        const known = group.map((h) => h.gustKt).filter((g): g is number => g !== null)
        return known.length ? Math.max(...known) : null
      })(),
      directions: [...new Set(group.map((h) => h.windDirection))],
      temperatureFAvg:
        Math.round(group.reduce((s, h) => s + h.temperatureF, 0) / group.length),
      hasUnknownGust: group.some((h) => h.gustKt === null),
    }
  })
}

/**
 * "gusting 22", or null when there is nothing worth saying.
 *
 * Nothing is worth saying in two cases: no hour reported a gust, or the gust does not
 * exceed the sustained maximum. On a steady day "gusting 13" against a 13 kt maximum
 * is noise. The number earns its place precisely when the two diverge, which is the
 * case the explainer has always said matters.
 *
 * Lives here, next to the window it describes, so the page and the calendar feed phrase
 * it identically. They already share buildWindows; sharing this keeps them from drifting.
 */
export function gustLabel(w: SailWindow): string | null {
  if (w.gustKtMax === null) return null
  const gust = Math.round(w.gustKtMax)
  return gust > Math.round(w.windKtMax) ? `gusting ${gust}` : null
}

/** "7 to 13 kt gusting 22, NNW/N" ... the one wind phrase every surface uses. */
export function windPhrase(w: SailWindow): string {
  const gust = gustLabel(w)
  const range = `${Math.round(w.windKtMin)} to ${Math.round(w.windKtMax)} kt`
  return `${range}${gust ? ` ${gust}` : ''}, ${w.directions.join('/')}`
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
