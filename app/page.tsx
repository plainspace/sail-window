import Link from 'next/link'
import { SPOTS } from '@/config/spots'

// The landing page. Static: it only reads the configured spots, no forecast, so it
// carries no per-request data and needs no dynamic rendering.
export default function Home() {
  const single = SPOTS.length === 1

  return (
    <main>
      <div className="wrap">
        <header className="hero">
          <div className="hero-text">
            <p className="eyebrow">Sail window</p>
            <h1 className="headline">When can I sail?</h1>
            <p className="standfirst">
              This tells you when the conditions are right to sail at one specific place,
              read straight from the Open-Meteo forecast and four plain gates: daylight, a
              sustained wind band, a gust ceiling, and a rain limit. Not a weather report... a
              yes or no. Days that clear every gate are windows. Read them on the page, or
              subscribe to them as a calendar.
            </p>
          </div>
        </header>

        <p className="offseason">
          Coverage is worldwide. The forecast comes from Open-Meteo, so this works for any
          water on Earth, not only the US. For US spots the US National Weather Service is
          shown as a quiet second opinion when the two sources disagree.
        </p>

        <section className="block">
          <h2>{single ? 'Live example' : 'Spots'}</h2>
          <p className="lede">
            {single
              ? 'One spot is configured so far. It runs on live data right now:'
              : 'Each of these is configured and running on live data:'}
          </p>
          <ul className="cards">
            {SPOTS.map((s) => (
              <li key={s.slug}>
                <Link className="card pass-card spot-link" href={`/${s.slug}`}>
                  <span className="tag good">spot</span>
                  <span className="card-when">
                    <strong>{s.name}</strong> {s.region}
                  </span>
                  <span className="card-meta">
                    /{s.slug} · {s.wind.minKt} to {s.wind.maxKt} kt window
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="block">
          <h2>Or put it in your calendar</h2>
          <p className="lede">
            Every spot publishes its windows as a calendar feed at{' '}
            <code>/&lt;slug&gt;/calendar.ics</code>, so the answer can sit next to the rest
            of your week instead of on a page you have to remember to open. Open a spot and
            click <strong>Subscribe to these windows</strong>.
          </p>
          <p className="lede">
            Subscribe to it rather than downloading it. Each refetch replaces the whole
            feed, so windows appear and disappear as the forecast changes instead of going
            stale in your calendar. Events are marked free, never busy... a forecast is not
            a commitment. Out of season, and in a week with nothing sailable, the feed is
            simply empty.
          </p>
        </section>

        <section className="block explainer">
          <h2>Add your own spot</h2>
          <p>
            It is open source and built to be pointed at any water on Earth. Three steps:
          </p>
          <ol className="limits">
            <li>
              Add an entry to <code>config/spots.ts</code> with a slug, a name, the{' '}
              <code>lat</code> and <code>lon</code> of the water, a timezone, and your own
              wind band, gust ceiling, rain limit, and season. Every field is required, so
              each spot states its own idea of what counts as sailable.
            </li>
            <li>
              Open <code>/your-slug</code>. Open-Meteo needs no key and no setup, so the
              forecast just works from the coordinates. The calendar feed at{' '}
              <code>/your-slug/calendar.ics</code> comes with it, nothing to configure.
            </li>
            <li>
              Optionally set <code>NWS_CONTACT</code> in your environment. It is only used for
              the US National Weather Service second opinion, which the Weather Service
              requires a contact for. Leave it unset and US spots simply skip the second
              opinion; spots outside the US never use it.
            </li>
          </ol>
          <p>
            An outline is optional. Give a spot a GeoJSON outline under <code>data/</code> and
            it draws a small silhouette with a wind arrow; leave it off and the page simply
            renders without one. Everything else works the same.
          </p>
        </section>

        <footer>Forecast data from Open-Meteo, CC BY 4.0. US second opinion from the US National Weather Service.</footer>
      </div>
    </main>
  )
}
