import { degreesToCardinal, type HourlyConditions } from './nws'
import type { Spot } from '@/config/spots'

// Open-Meteo returns parallel arrays under `hourly`, indexed by `hourly.time`. This
// is far simpler than NWS's run-length encoding: no expansion, just a positional read
// across the arrays. We request knots and Fahrenheit directly (wind_speed_unit=kn,
// temperature_unit=fahrenheit), so nothing here converts units... doing so would
// double-convert and corrupt every value.
type OpenMeteoHourly = {
  time: string[]
  wind_speed_10m?: (number | null)[]
  wind_gusts_10m?: (number | null)[]
  wind_direction_10m?: (number | null)[]
  precipitation_probability?: (number | null)[]
  cloud_cover?: (number | null)[]
  temperature_2m?: (number | null)[]
}

export function parseOpenMeteo(json: unknown): HourlyConditions[] {
  const h = (json as { hourly?: OpenMeteoHourly }).hourly
  if (!h || !Array.isArray(h.time)) {
    throw new Error('Open-Meteo response did not include an hourly.time array')
  }

  const rows: HourlyConditions[] = []
  for (let i = 0; i < h.time.length; i++) {
    const speed = h.wind_speed_10m?.[i]
    const dir = h.wind_direction_10m?.[i]
    const temp = h.temperature_2m?.[i]
    // Wind, direction and temperature are load-bearing: an hour missing any of them
    // cannot be judged, so it is dropped rather than guessed. This mirrors the NWS
    // parser, which skips hours lacking speed, direction or temperature.
    if (speed === null || speed === undefined) continue
    if (dir === null || dir === undefined) continue
    if (temp === null || temp === undefined) continue

    const gust = h.wind_gusts_10m?.[i]
    const pop = h.precipitation_probability?.[i]
    // Sky cover is display-only context, never a gate, so a missing value is null
    // rather than a reason to drop the hour.
    const sky = h.cloud_cover?.[i]

    rows.push({
      // Open-Meteo emits UTC timestamps as 'YYYY-MM-DDTHH:MM' with no zone marker
      // (we requested timezone=UTC). Normalise to the same millisecond-precision UTC
      // ISO string the NWS parser produces so downstream code sees one format.
      startTime: new Date(`${h.time[i]}:00Z`).toISOString(),
      windKt: speed, // wind_speed_unit=kn, already knots
      // A null gust is unknown, not zero, and never vetoes downstream.
      gustKt: gust === null || gust === undefined ? null : gust,
      windDirectionDeg: dir,
      windDirection: degreesToCardinal(dir),
      precipProbability: pop === null || pop === undefined ? 0 : pop,
      temperatureF: temp, // temperature_unit=fahrenheit, already Fahrenheit
      skyCoverPct: sky === null || sky === undefined ? null : sky,
    })
  }
  return rows
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

export async function fetchForecast(spot: Spot): Promise<{ raw: unknown; hours: HourlyConditions[] }> {
  const params = new URLSearchParams({
    latitude: String(spot.lat),
    longitude: String(spot.lon),
    hourly:
      'wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,cloud_cover,temperature_2m',
    wind_speed_unit: 'kn',
    temperature_unit: 'fahrenheit',
    timezone: 'UTC',
    forecast_days: '7',
  })
  // Cache the upstream response for 15 minutes, matching the NWS module. The page
  // renders per request, but Open-Meteo updates on a coarser cadence and this keeps
  // us far below its free non-commercial limit.
  const res = await fetch(`${OPEN_METEO_URL}?${params}`, { next: { revalidate: 900 } })
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status} ${res.statusText}`)
  const raw = await res.json()
  return { raw, hours: parseOpenMeteo(raw) }
}
