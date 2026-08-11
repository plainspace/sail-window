import { fetchForecast } from '@/lib/nws'
import { buildWindows, buildNearMisses } from '@/lib/windows'
import { judge, inSeason } from '@/lib/rules'
import './dunmore.css'

export const revalidate = 1800

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...opts }).format(new Date(iso))

const day = (iso: string) => fmt(iso, { weekday: 'long' })
const time = (iso: string) => fmt(iso, { hour: 'numeric' }).toLowerCase()

export default async function Page() {
  const { hours } = await fetchForecast()
  const windows = buildWindows(hours)
  const misses = buildNearMisses(hours)
  const next = windows[0]
  const openNow = inSeason(new Date().toISOString())

  return (
    <main>
      {!openNow && (
        <p className="offseason">
          Off season. Lake Dunmore is closed for sailing from November 2 through April 30.
          Forecast data below is shown for reference only.
        </p>
      )}
      <h1 className="headline">
        {!openNow
          ? 'Off season.'
          : next
            ? `Next window: ${day(next.start)} ${time(next.start)}, ${next.hours} hours, ${Math.round(next.windKtMin)} to ${Math.round(next.windKtMax)} kt ${next.directions.join('/')}`
            : 'Nothing sailable in the next week.'}
      </h1>

      <section>
        <h2>Windows</h2>
        {windows.length === 0 && <p className="quiet">No hours cleared every gate.</p>}
        <ul className="windows">
          {windows.map((w) => (
            <li key={w.start}>
              <strong>{day(w.start)}</strong> {time(w.start)} to {time(w.end)}
              <span className="quiet"> · {w.hours} hrs · {Math.round(w.windKtMin)} to {Math.round(w.windKtMax)} kt {w.directions.join('/')} · {w.temperatureFAvg}&deg;F</span>
              {w.hasUnknownGust && <span className="flag"> gust data missing</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Hours</h2>
        <div className="grid">
          {hours.map((h) => {
            const v = judge(h)
            return (
              <span
                key={h.startTime}
                className={v.pass ? 'cell pass' : 'cell fail'}
                title={`${day(h.startTime)} ${time(h.startTime)} · ${Math.round(h.windKt)} kt ${h.windDirection}${v.pass ? '' : ' · ' + v.reasons.join(', ')}`}
              />
            )
          })}
        </div>
      </section>

      <section>
        <h2>Near misses</h2>
        {misses.length === 0 && <p className="quiet">Nothing came close.</p>}
        <ul className="misses">
          {misses.map((m) => (
            <li key={m.start}>
              <strong>{day(m.start)}</strong> {time(m.start)} to {time(m.end)}
              <span className="quiet"> · {m.hours} hrs · failed only on {m.reason} ({m.margin})</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
