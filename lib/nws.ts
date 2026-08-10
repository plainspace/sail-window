import { CONFIG } from './config'

export type HourlyConditions = {
  startTime: string
  windKt: number
  gustKt: number | null
  windDirectionDeg: number
  windDirection: string
  precipProbability: number
  temperatureF: number
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

  const rows: HourlyConditions[] = []
  for (const key of [...speed.keys()].sort()) {
    const d = dir.get(key)
    const pr = pop.get(key)
    const t = temp.get(key)
    if (d === undefined || pr === undefined || t === undefined) continue
    const g = gust.get(key)
    rows.push({
      startTime: key,
      windKt: kmhToKt(speed.get(key)!),
      gustKt: g === undefined ? null : kmhToKt(g),
      windDirectionDeg: d,
      windDirection: degreesToCardinal(d),
      precipProbability: pr,
      temperatureF: cToF(t),
    })
  }
  return rows
}

export async function fetchForecast(): Promise<{ raw: unknown; hours: HourlyConditions[] }> {
  const res = await fetch(CONFIG.nws.gridpointUrl, {
    headers: { 'User-Agent': CONFIG.nws.userAgent, Accept: 'application/geo+json' },
    next: { revalidate: 1800 },
  })
  if (!res.ok) throw new Error(`NWS returned ${res.status} ${res.statusText}`)
  const raw = await res.json()
  return { raw, hours: parseGridpoint(raw) }
}
