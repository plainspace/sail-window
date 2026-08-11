import { judge } from '@/lib/rules'
import type { HourlyConditions } from '@/lib/nws'

const TZ = 'America/New_York'
const SCALE_MAX = 25 // knots; fixed so bars compare across days

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(iso))

const dayKey = (iso: string) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' })
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

// NWS gives the direction wind blows FROM. An arrow depicting motion points to deg + 180.
function DirArrow({ fromDeg }: { fromDeg: number }) {
  return (
    <svg className="dir" viewBox="-6 -6 12 12" aria-hidden="true">
      <g transform={`rotate(${fromDeg + 180})`}>
        <line x1="0" y1="4.5" x2="0" y2="-3.5" />
        <path d="M0,-5 L3,-1 L-3,-1 Z" />
      </g>
    </svg>
  )
}

function speedClass(windKt: number, pass: boolean): string {
  if (pass) return 'sp-pass'
  if (windKt < 7) return 'sp-light'
  if (windKt > 20) return 'sp-strong'
  return 'sp-mid'
}

export function WindStrip({ hours }: { hours: HourlyConditions[] }) {
  // Group consecutive hours into day columns, preserving order.
  const days: { key: string; hours: HourlyConditions[] }[] = []
  for (const h of hours) {
    const k = dayKey(h.startTime)
    const last = days[days.length - 1]
    if (last && last.key === k) last.hours.push(h)
    else days.push({ key: k, hours: [h] })
  }

  return (
    <div className="strip-scroll" role="group" aria-label="Hour-by-hour wind forecast">
      <div className="strip-axis" aria-hidden="true">
        <span style={{ bottom: `${(20 / SCALE_MAX) * 100}%` }}>20</span>
        <span style={{ bottom: `${(7 / SCALE_MAX) * 100}%` }}>7</span>
        <span style={{ bottom: '0' }}>0 kt</span>
      </div>
      <div className="strip">
        {days.map((d) => (
          <div className="day" key={d.key}>
            <div className="day-cols">
              {d.hours.map((h) => {
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
                return (
                  <div
                    className={`col ${pass ? 'is-pass' : 'is-fail'}${dark ? ' is-dark' : ''}`}
                    key={h.startTime}
                    title={title}
                  >
                    <div className="graph">
                      {showGust && gustPct > barPct && (
                        <span className="gust" style={{ bottom: `${barPct}%`, height: `${gustPct - barPct}%` }} />
                      )}
                      <span className={`bar ${speedClass(h.windKt, pass)}`} style={{ height: `${barPct}%` }} />
                      {pass && <span className="pip" aria-hidden="true" />}
                    </div>
                    <DirArrow fromDeg={h.windDirectionDeg} />
                    <span className="hr">{hourShort(h.startTime)}</span>
                  </div>
                )
              })}
            </div>
            <div className="day-label">{d.key}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
