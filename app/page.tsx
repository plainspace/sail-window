import { fetchForecast } from '@/lib/nws'
import { buildWindows, buildNearMisses } from '@/lib/windows'
import { inSeason } from '@/lib/rules'
import { WindStrip } from '@/components/WindStrip'
import { LakeSilhouette } from '@/components/LakeSilhouette'
import './dunmore.css'

// Render fresh HTML on every request so no visitor is ever served a stale forecast.
// The upstream NWS call is still cached (see lib/nws.ts), so this does not hammer them.
export const dynamic = 'force-dynamic'

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

  // One arrow for the silhouette: the next window's opening hour if there is a
  // window, otherwise the first forecast hour we have.
  const arrowHour = (next && hours.find((h) => h.startTime === next.start)) || hours[0]

  const headline = !openNow
    ? 'Off season. The lake is frozen.'
    : next
      ? `Next window: ${day(next.start)} ${time(next.start)}, ${next.hours} hours, ${Math.round(next.windKtMin)} to ${Math.round(next.windKtMax)} kt ${next.directions.join('/')}`
      : 'Nothing sailable in the next week.'

  return (
    <main>
      <div className="wrap">
        <header className="hero">
          <div className="hero-text">
            <p className="eyebrow">Lake Dunmore, Vermont</p>
            <h1 className="headline">{headline}</h1>
            <p className="standfirst">
              A yes-or-no read on when the conditions actually allow sailing this week,
              built from the National Weather Service forecast and four plain gates.
            </p>
          </div>
          {arrowHour && (
            <LakeSilhouette
              fromDeg={arrowHour.windDirectionDeg}
              cardinal={arrowHour.windDirection}
              windKt={arrowHour.windKt}
            />
          )}
        </header>

        {!openNow && (
          <p className="offseason">
            The lake is closed for sailing from November 2 through April 30, when it
            freezes. The forecast below is shown for reference only.
          </p>
        )}

        <section className="block">
          <h2>Next seven days, hour by hour</h2>
          <p className="lede">
            Each bar is one hour of sustained wind on a fixed 0 to 25 knot scale. The
            shaded band is the 7 to 20 knot target. Green bars clear every gate and are
            sailable... everything else fell short somewhere. Arrows point the way the
            wind is blowing. A small sky icon under each hour reads cloud cover, from a
            warm sun to a grey cloud, and the thin bar under each hour is the chance of
            rain, going solid once it crosses the 30% gate. Hover an hour for the full
            detail. Scroll sideways for the whole week.
          </p>
          <WindStrip hours={hours} />
          <ul className="legend" aria-hidden="true">
            <li><span className="swatch sw-pass" /> sailable</li>
            <li><span className="swatch sw-mid" /> in the wind band, blocked elsewhere</li>
            <li><span className="swatch sw-light" /> too light</li>
            <li><span className="swatch sw-strong" /> too strong</li>
            <li><span className="swatch sw-gust" /> gust</li>
            <li><span className="swatch sw-precip" /> rain, solid at 30%+</li>
            <li>
              <svg className="sky-icon legend-sky" viewBox="0 0 16 16" aria-hidden="true">
                <circle className="sun" cx="6.4" cy="6.1" r="3" />
                <g fill="currentColor">
                  <circle cx="5.4" cy="10.2" r="2.1" />
                  <circle cx="8" cy="8.7" r="2.8" />
                  <circle cx="10.7" cy="10.2" r="2.1" />
                  <rect x="3.3" y="10" width="9.4" height="2.7" rx="1.35" />
                </g>
              </svg>
              sky, sun to cloud
            </li>
          </ul>
        </section>

        <section className="block">
          <h2>Sailable windows</h2>
          {windows.length === 0 ? (
            <p className="lede">
              No stretch of three or more hours cleared every gate this week. That is a
              real answer, not a gap... the conditions simply do not line up.
            </p>
          ) : (
            <ul className="cards">
              {windows.map((w) => (
                <li className="card pass-card" key={w.start}>
                  <span className="tag good">window</span>
                  <span className="card-when">
                    <strong>{day(w.start)}</strong> {time(w.start)} to {time(w.end)}
                  </span>
                  <span className="card-meta">
                    {w.hours} hrs · {Math.round(w.windKtMin)} to {Math.round(w.windKtMax)} kt{' '}
                    {w.directions.join('/')} · {w.temperatureFAvg}&deg;F
                    {w.hasUnknownGust && <span className="flag"> · gust data missing</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="block">
          <h2>Near misses</h2>
          <p className="lede">
            Stretches of three or more hours that failed exactly one gate. Never sailable,
            shown so an empty week is distinguishable from a broken page.
          </p>
          {misses.length === 0 ? (
            <p className="quiet">Nothing came close.</p>
          ) : (
            <ul className="cards">
              {misses.map((m) => (
                <li className="card" key={m.start}>
                  <span className="tag">near miss</span>
                  <span className="card-when">
                    <strong>{day(m.start)}</strong> {time(m.start)} to {time(m.end)}
                  </span>
                  <span className="card-meta">
                    {m.hours} hrs · failed only on {m.reason} ({m.margin})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="block explainer">
          <h2>How this decides</h2>
          <p>
            A weather forecast tells you what the weather will be. That is not the
            question. The question is when this week you can actually go sailing, which
            has a yes-or-no answer. Every hour is judged on its own against four gates,
            and it either clears all four or it does not. No scoring, no weighting, no
            partial credit.
          </p>

          <div className="gates">
            <div className="gate">
              <div className="gate-head">
                <span className="gate-name">Daylight</span>
                <span className="gate-rule">sunrise to sunset</span>
              </div>
              <p className="gate-why">
                Computed for the lake's own latitude and longitude, so it tracks the
                season instead of assuming a fixed window. Anything after dark is
                discarded before the other rules run.
              </p>
            </div>

            <div className="gate">
              <div className="gate-head">
                <span className="gate-name">Sustained wind</span>
                <span className="gate-rule">7 to 20 kt</span>
              </div>
              <p className="gate-why">
                Below 7 knots a keelboat is drifting with opinions. Above 20 it stops
                being relaxing. This is the band, not an aspiration.
              </p>
            </div>

            <div className="gate">
              <div className="gate-head">
                <span className="gate-name">Gusts</span>
                <span className="gate-rule">30 kt ceiling</span>
              </div>
              <p className="gate-why">
                A separate field from sustained wind, and the two diverge constantly in
                valley terrain. Ten sustained gusting twenty-five is a different day from
                a steady fourteen, and an average cannot tell them apart.
              </p>
            </div>

            <div className="gate">
              <div className="gate-head">
                <span className="gate-name">Precipitation</span>
                <span className="gate-rule">under 30% chance</span>
              </div>
              <p className="gate-why">
                The forecast gives a probability, not a yes or no, so the rule needs a
                line. Thirty percent is the conventional "slight chance" mark... it keeps
                usable days without pretending rain is impossible.
              </p>
            </div>
          </div>

          <h3>From hours to windows</h3>
          <p>
            Consecutive passing hours merge into one window, and any window shorter than
            three hours is thrown away. Three hours is roughly what it takes to get out,
            sail properly, and come back without watching the clock. A lone good hour
            looks encouraging on a chart and is useless in practice. Windows are listed
            soonest first, not ranked... they have all cleared every gate, so the only
            thing that separates them is when they happen.
          </p>

          <h3>Near misses, and why they exist</h3>
          <p>
            Pass-or-fail rules throw away the most useful thing the forecast knows: how
            close a failure was. An hour at 6.8 knots fails exactly like an hour at 2. So
            any stretch of three or more hours that failed exactly one gate is reported
            separately, with the gate named and the margin shown. It is never presented as
            sailable. It exists because a page that is empty for a week is otherwise
            indistinguishable from a page that is broken.
          </p>

          <h3>What it deliberately does not do</h3>
          <ul className="limits">
            <li>
              <strong>It does not pretend to know the wind on the water.</strong> The
              forecast grid is about 1.5 miles square, and the lake sits in a valley with
              a mountain on its east side. Terrain at that scale is smoothed away. No
              public forecast resolves this lake, and claiming otherwise would be the
              easiest lie in the whole system.
            </li>
            <li>
              <strong>It ignores cloud cover.</strong> Overcast and 12 knots is a good
              sailing day. Treating sunshine as a requirement would delete a large share of
              perfectly good afternoons for what is really a comfort preference.
            </li>
            <li>
              <strong>It runs May through November only.</strong> Otherwise a beautiful
              14-knot January afternoon clears every gate and ranks first, on a lake that
              is frozen solid.
            </li>
          </ul>
        </section>

        <footer>
          Forecast data from the US National Weather Service. Lake outline from
          OpenStreetMap contributors, ODbL.
        </footer>
      </div>
    </main>
  )
}
