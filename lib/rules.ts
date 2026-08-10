import { CONFIG } from './config'
import { isDaylight } from './daylight'
import type { HourlyConditions } from './nws'

export type FailReason =
  | 'dark' | 'wind-too-light' | 'wind-too-strong'
  | 'gusty' | 'precip' | 'off-season'

export type Verdict = { pass: true } | { pass: false; reasons: FailReason[] }

/** Month/day comparison in the lake's local timezone, both bounds inclusive. */
export function inSeason(iso: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.location.tz,
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(iso))
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)
  const key = month * 100 + day
  const { start, end } = CONFIG.season
  return key >= start.month * 100 + start.day && key <= end.month * 100 + end.day
}

export function judge(h: HourlyConditions): Verdict {
  const reasons: FailReason[] = []
  if (!inSeason(h.startTime)) reasons.push('off-season')
  if (!isDaylight(h.startTime)) reasons.push('dark')
  if (h.windKt < CONFIG.wind.minKt) reasons.push('wind-too-light')
  if (h.windKt > CONFIG.wind.maxKt) reasons.push('wind-too-strong')
  // A null gust is unknown, not zero, and never vetoes.
  if (h.gustKt !== null && h.gustKt > CONFIG.wind.maxGustKt) reasons.push('gusty')
  if (h.precipProbability >= CONFIG.precip.maxProbability) reasons.push('precip')
  return reasons.length === 0 ? { pass: true } : { pass: false, reasons }
}
