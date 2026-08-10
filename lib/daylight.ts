import * as SunCalc from 'suncalc'
import { CONFIG } from './config'

export function sunTimes(date: Date): { sunrise: Date; sunset: Date } {
  const t = SunCalc.getTimes(date, CONFIG.location.lat, CONFIG.location.lon)
  return { sunrise: t.sunrise, sunset: t.sunset }
}

/** True when the given instant falls between sunrise and sunset at the lake. */
export function isDaylight(iso: string): boolean {
  const at = new Date(iso)
  const { sunrise, sunset } = sunTimes(at)
  return at >= sunrise && at <= sunset
}
