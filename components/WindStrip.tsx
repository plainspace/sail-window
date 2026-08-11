import { judge } from '@/lib/rules'
import { buildWindows, buildMarginalWindows } from '@/lib/windows'
import type { HourlyConditions } from '@/lib/nws'
import type { Spot } from '@/config/spots'
import { WindStripView, type DayGroup, type Scale } from './WindStripView'

const fmt = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(iso))

const reasonLabel: Record<string, string> = {
  dark: 'after dark',
  'wind-too-light': 'wind too light',
  'wind-too-strong': 'wind too strong',
  gusty: 'gusts too strong',
  precip: 'rain likely',
  'off-season': 'off season',
}

function speedClass(windKt: number, pass: boolean, spot: Spot): string {
  if (pass) return 'sp-pass'
  if (windKt < spot.wind.minKt) return 'sp-light'
  if (windKt > spot.wind.maxKt) return 'sp-strong'
  return 'sp-mid'
}

// Sky cover is display-only context. Buckets, not a gate. Four active states plus
// unknown; thresholds fixed to the physical percentage, not tuned to one week.
type Sky = 'clear' | 'mostly-clear' | 'partly' | 'cloudy' | 'unknown'
function skyState(pct: number | null): Sky {
  if (pct === null) return 'unknown'
  if (pct < 25) return 'clear'
  if (pct < 50) return 'mostly-clear'
  if (pct < 75) return 'partly'
  return 'cloudy'
}
const skyWord: Record<Sky, string> = {
  clear: 'clear',
  'mostly-clear': 'mostly clear',
  partly: 'partly cloudy',
  cloudy: 'cloudy',
  unknown: 'sky n/a',
}

// Server component: builds a fully serializable day-group structure and hands it
// to the client view. No functions or JSX cross the boundary, only plain data.
export function WindStrip({ hours, spot }: { hours: HourlyConditions[]; spot: Spot }) {
  const tz = spot.tz
  const dayLabel = (iso: string) => fmt(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' })
  // Two letters, not three. The chips are a fixed grid across the full width, so at
  // 390px each one is about 41px and a three-letter label does not fit.
  const dayChip = (iso: string) => fmt(iso, tz, { weekday: 'short' }).slice(0, 2)
  const dayFull = (iso: string) => fmt(iso, tz, { weekday: 'long' })
  const hourShort = (iso: string) => fmt(iso, tz, { hour: 'numeric' }).toLowerCase().replace(' ', '')
  const hourLong = (iso: string) => fmt(iso, tz, { weekday: 'long', hour: 'numeric' }).toLowerCase()

  // Fixed knot scale, with a little headroom above the strong-wind gate so bars
  // compare across days. Derived from the spot so the axis and target band match
  // its own wind band. For Dunmore (max 20) this is 25, unchanged.
  const scale: Scale = {
    max: spot.wind.maxKt + 5,
    min: spot.wind.minKt,
    hi: spot.wind.maxKt,
  }

  // Days that contain a qualifying window (3+ consecutive passing hours), keyed by
  // the same local-date label used to group the strip, so matching stays in the
  // spot's timezone rather than UTC.
  const windowDays = new Set(buildWindows(hours, spot).map((w) => dayLabel(w.start)))
  // Days whose best result is a marginal window (close to the floor but gusting enough
  // to move). Ranks below a real window, above isolated passing hours.
  const marginalDays = new Set(buildMarginalWindows(hours, spot).map((m) => dayLabel(m.start)))
  const days: DayGroup[] = []

  for (const h of hours) {
    const key = dayLabel(h.startTime)
    let group = days[days.length - 1]
    if (!group || group.key !== key) {
      group = { key, chip: dayChip(h.startTime), full: dayFull(h.startTime), dot: 'none', cols: [] }
      days.push(group)
    }

    const v = judge(h, spot)
    const pass = v.pass
    const reasons = v.pass ? [] : v.reasons
    const dark = reasons.includes('dark')
    const barPct = Math.min(h.windKt / scale.max, 1) * 100
    const showGust = h.gustKt !== null && h.gustKt > h.windKt
    const gustPct = showGust ? Math.min((h.gustKt as number) / scale.max, 1) * 100 : 0
    const sky = skyState(h.skyCoverPct)
    const precipPct = Math.round(h.precipProbability)
    const precipFail = reasons.includes('precip') // failed the precip gate
    const skyTip =
      h.skyCoverPct === null ? 'sky n/a' : `${skyWord[sky]} ${Math.round(h.skyCoverPct)}%`
    const title =
      `${hourLong(h.startTime)} · ${Math.round(h.windKt)} kt` +
      (showGust ? ` gust ${Math.round(h.gustKt as number)}` : '') +
      ` · from ${h.windDirection} · ${precipPct}% rain · ${skyTip}` +
      (pass ? ' · sailable' : ` · ${reasons.map((r) => reasonLabel[r] ?? r).join(', ')}`)

    group.cols.push({
      iso: h.startTime,
      windRounded: Math.round(h.windKt),
      fromDeg: h.windDirectionDeg,
      barPct,
      gustPct,
      showGust,
      pass,
      dark,
      speed: speedClass(h.windKt, pass, spot),
      sky,
      precipPct,
      precipFail,
      hr: hourShort(h.startTime),
      title,
    })
  }

  // Dot state per day: a window beats a marginal window beats isolated passing hours
  // beats nothing.
  for (const group of days) {
    if (windowDays.has(group.key)) group.dot = 'window'
    else if (marginalDays.has(group.key)) group.dot = 'marginal'
    else if (group.cols.some((c) => c.pass)) group.dot = 'hour'
    else group.dot = 'none'
  }

  return <WindStripView days={days} scale={scale} />
}
