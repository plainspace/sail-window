import { nwsUserAgent } from './config'
import type { Spot } from '@/config/spots'

export type HourlyConditions = {
  startTime: string
  windKt: number
  gustKt: number | null
  windDirectionDeg: number
  windDirection: string
  precipProbability: number
  temperatureF: number
  skyCoverPct: number | null
}

type NwsValue = { validTime: string; value: number | null }
type NwsSeries = { uom?: string; values: NwsValue[] }

const HOUR_MS = 3600_000

export function durationToHours(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso)
  if (!m || iso === 'P') throw new Error(`Unparseable ISO duration: ${iso}`)
  const days = Number(m[1] ?? 0)
  const hours = Number(m[2] ?? 0)
  const total = days * 24 + hours
  if (total < 1) throw new Error(`Duration shorter than one hour: ${iso}`)
  return total
}

export function degreesToCardinal(deg: number): string {
  const names = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ]
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16
  return names[idx]
}

function expand(series: NwsSeries | undefined): Map<string, number> {
  const out = new Map<string, number>()
  if (!series) return out
  for (const { validTime, value } of series.values) {
    if (value === null) continue
    const [instant, duration] = validTime.split('/')
    const start = Date.parse(instant)
    const span = durationToHours(duration)
    for (let i = 0; i < span; i++) {
      out.set(new Date(start + i * HOUR_MS).toISOString(), value)
    }
  }
  return out
}

const kmhToKt = (kmh: number) => kmh / 1.852
const cToF = (c: number) => (c * 9) / 5 + 32

export function parseGridpoint(json: unknown): HourlyConditions[] {
  const p = (json as { properties: Record<string, NwsSeries> }).properties
  const speed = expand(p.windSpeed)
  const gust = expand(p.windGust)
  const dir = expand(p.windDirection)
  const pop = expand(p.probabilityOfPrecipitation)
  const temp = expand(p.temperature)
  const sky = expand(p.skyCover)

  const rows: HourlyConditions[] = []
  for (const key of [...speed.keys()].sort()) {
    const d = dir.get(key)
    const pr = pop.get(key)
    const t = temp.get(key)
    if (d === undefined || pr === undefined || t === undefined) continue
    const g = gust.get(key)
    // Sky cover is display-only context, never a gate, so a missing value is null
    // rather than a reason to drop the hour.
    const sc = sky.get(key)
    rows.push({
      startTime: key,
      windKt: kmhToKt(speed.get(key)!),
      gustKt: g === undefined ? null : kmhToKt(g),
      windDirectionDeg: d,
      windDirection: degreesToCardinal(d),
      precipProbability: pr,
      temperatureF: cToF(t),
      skyCoverPct: sc === undefined ? null : sc,
    })
  }
  return rows
}

// NWS grid assignments for a coordinate never change, so resolve the gridpoint URL
// once per lat/lon and keep it. Hardcoding the grid by hand is how the original bug
// happened, where a point on land forecast a different cell than the water.
const gridpointCache = new Map<string, Promise<string>>()

export function resolveGridpointUrl(lat: number, lon: number): Promise<string> {
  const key = `${lat},${lon}`
  const cached = gridpointCache.get(key)
  if (cached) return cached

  const pending = (async () => {
    // revalidate: false caches this indefinitely in Next's data cache too; the Map
    // dedupes within a single render.
    const res = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { 'User-Agent': nwsUserAgent(), Accept: 'application/geo+json' },
      next: { revalidate: false },
    })
    if (!res.ok) throw new Error(`NWS points lookup returned ${res.status} ${res.statusText}`)
    const json = (await res.json()) as { properties?: { forecastGridData?: unknown } }
    const url = json.properties?.forecastGridData
    if (typeof url !== 'string') {
      throw new Error('NWS points response did not include properties.forecastGridData')
    }
    return url
  })()

  gridpointCache.set(key, pending)
  // Do not cache a failed lookup: drop it so the next call retries.
  pending.catch(() => gridpointCache.delete(key))
  return pending
}

export async function fetchForecast(spot: Spot): Promise<{ raw: unknown; hours: HourlyConditions[] }> {
  const gridpointUrl = await resolveGridpointUrl(spot.lat, spot.lon)
  // Cache the upstream response for 15 minutes: the page renders per request, but
  // NWS updates this gridpoint only a few times a day and asks callers not to poll
  // aggressively, so one call per 15 minutes is generous.
  const res = await fetch(gridpointUrl, {
    headers: { 'User-Agent': nwsUserAgent(), Accept: 'application/geo+json' },
    next: { revalidate: 900 },
  })
  if (!res.ok) throw new Error(`NWS returned ${res.status} ${res.statusText}`)
  const raw = await res.json()
  return { raw, hours: parseGridpoint(raw) }
}
