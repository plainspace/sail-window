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
              read straight from the US National Weather Service forecast and four plain
              gates: daylight, a sustained wind band, a gust ceiling, and a rain limit. Not a
              weather report... a yes or no.
            </p>
          </div>
        </header>

        <p className="offseason">
          Coverage is the United States only. The forecast comes from the US National
          Weather Service, which does not cover anywhere else... this app cannot answer for a
          spot outside the US.
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

        <section className="block explainer">
          <h2>Add your own spot</h2>
          <p>
            It is open source and built to be pointed at anywhere the National Weather
            Service covers. Three steps:
          </p>
          <ol className="limits">
            <li>
              Add an entry to <code>config/spots.ts</code> with a slug, a name, the{' '}
              <code>lat</code> and <code>lon</code> of the water, a timezone, and your own
              wind band, gust ceiling, rain limit, and season.
            </li>
            <li>
              Set <code>NWS_CONTACT</code> in your environment to an email address or URL.
              The Weather Service requires a contact on every request and rejects calls
              without one.
            </li>
            <li>
              Open <code>/your-slug</code>. The NWS gridpoint resolves automatically from the
              coordinates, so there is nothing to look up by hand.
            </li>
          </ol>
          <p>
            An outline is optional. Give a spot a GeoJSON outline under <code>data/</code> and
            it draws a small silhouette with a wind arrow; leave it off and the page simply
            renders without one. Everything else works the same.
          </p>
        </section>

        <footer>Forecast data from the US National Weather Service.</footer>
      </div>
    </main>
  )
}
