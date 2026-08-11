import * as SunCalc from 'suncalc'
import { CONFIG } from './config'

export function sunTimes(date: Date): { sunrise: Date; sunset: Date } {
  const t = SunCalc.getTimes(date, CONFIG.location.lat, CONFIG.location.lon)
  // Lake Dunmore is at 43.9 N, where the sun always rises and sets, so these are never null.
  return { sunrise: t.sunrise!, sunset: t.sunset! }
}

/** True when the given instant falls between sunrise and sunset at the lake. */
export function isDaylight(iso: string): boolean {
  const at = new Date(iso)
  const { sunrise, sunset } = sunTimes(at)
  return at >= sunrise && at <= sunset
}
