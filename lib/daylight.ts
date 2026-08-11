import * as SunCalc from 'suncalc'
import type { Spot } from '@/config/spots'

export function sunTimes(date: Date, spot: Spot): { sunrise: Date; sunset: Date } {
  const t = SunCalc.getTimes(date, spot.lat, spot.lon)
  // At the mid-latitudes NWS covers, the sun rises and sets every day, so these
  // are never null.
  return { sunrise: t.sunrise!, sunset: t.sunset! }
}

/** True when the given instant falls between sunrise and sunset at the spot. */
export function isDaylight(iso: string, spot: Spot): boolean {
  const at = new Date(iso)
  const { sunrise, sunset } = sunTimes(at, spot)
  return at >= sunrise && at <= sunset
}
