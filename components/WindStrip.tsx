import { judge } from '@/lib/rules'
import { buildWindows } from '@/lib/windows'
import type { HourlyConditions } from '@/lib/nws'
import { WindStripView, type DayGroup } from './WindStripView'

const TZ = 'America/New_York'
const SCALE_MAX = 25 // knots; fixed so bars compare across days

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(iso))

const dayLabel = (iso: string) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' })
const dayChip = (iso: string) => fmt(iso, { weekday: 'short' })
const dayFull = (iso: string) => fmt(iso, { weekday: 'long' })
const hourShort = (iso: string) => fmt(iso, { hour: 'numeric' }).toLowerCase().replace(' ', '')
const hourLong = (iso: string) => fmt(iso, { weekday: 'long', hour: 'numeric' }).toLowerCase()

const reasonLabel: Record<string, string> = {
  dark: 'after dark',
  'wind-too-light': 'wind too light',
  'wind-too-strong': 'wind too strong',
  gusty: 'gusts too strong',
  precip: 'rain likely',
  'off-season': 'off season',
}

function speedClass(windKt: number, pass: boolean): string {
  if (pass) return 'sp-pass'
  if (windKt < 7) return 'sp-light'
  if (windKt > 20) return 'sp-strong'
  return 'sp-mid'
}

// Server component: builds a fully serializable day-group structure and hands it
// to the client view. No functions or JSX cross the boundary, only plain data.
export function WindStrip({ hours }: { hours: HourlyConditions[] }) {
  // Days that contain a qualifying window (3+ consecutive passing hours), keyed by
  // the same local-date label used to group the strip, so matching stays in the
  // lake's timezone rather than UTC.
  const windowDays = new Set(buildWindows(hours).map((w) => dayLabel(w.start)))
  const days: DayGroup[] = []

  for (const h of hours) {
    const key = dayLabel(h.startTime)
    let group = days[days.length - 1]
    if (!group || group.key !== key) {
      group = { key, chip: dayChip(h.startTime), full: dayFull(h.startTime), dot: 'none', cols: [] }
      days.push(group)
    }

    const v = judge(h)
    const pass = v.pass
    const reasons = v.pass ? [] : v.reasons
    const dark = reasons.includes('dark')
    const barPct = Math.min(h.windKt / SCALE_MAX, 1) * 100
    const showGust = h.gustKt !== null && h.gustKt > h.windKt
    const gustPct = showGust ? Math.min((h.gustKt as number) / SCALE_MAX, 1) * 100 : 0
    const title =
      `${hourLong(h.startTime)} · ${Math.round(h.windKt)} kt` +
      (showGust ? ` gust ${Math.round(h.gustKt as number)}` : '') +
      ` · from ${h.windDirection} · ${Math.round(h.precipProbability)}% rain` +
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
      speed: speedClass(h.windKt, pass),
      hr: hourShort(h.startTime),
      title,
    })
  }

  // Dot state per day: a window beats isolated passing hours beats nothing.
  for (const group of days) {
    if (windowDays.has(group.key)) group.dot = 'window'
    else if (group.cols.some((c) => c.pass)) group.dot = 'hour'
    else group.dot = 'none'
  }

  return <WindStripView days={days} />
}
