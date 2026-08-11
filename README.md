# Sail window

Tells you when the conditions are right to sail at one specific place.

A weather forecast answers "what will the weather be." That is not the question. The
question is "when this week can I actually go," which has a yes or no answer. This
reads the US National Weather Service forecast, applies a few plain rules, and gives
you the answer.

Live example: [Lake Dunmore, Vermont](https://sail-window.vercel.app/dunmore)

## Coverage is the United States only

Forecasts come from the [US National Weather Service](https://www.weather.gov/documentation/services-web-api),
which covers the United States and its territories and nothing else. If your water is
outside the US, this app cannot answer for it. Swapping in another source would mean
rewriting `lib/nws.ts`, which is the only module that knows where the data comes from,
but nobody has done that.

## How it decides

Every hour of the forecast is judged on its own. It passes only if **all four** gates
hold. There is no scoring and no partial credit.

| Gate | Default | Why |
| --- | --- | --- |
| Daylight | sunrise to sunset | computed from the spot's own coordinates, so it tracks the season |
| Sustained wind | 7 to 20 kt | below is drifting, above stops being relaxing |
| Gusts | 30 kt ceiling | a separate field from sustained wind, and the two diverge constantly in valley terrain |
| Precipitation | under 30% chance | the forecast gives a probability, so a line has to be drawn somewhere |

Consecutive passing hours merge into a **window**. Windows shorter than three hours
are discarded, on the grounds that a shorter stretch does not justify getting the boat
out. Windows are listed in chronological order, not ranked, because every one of them
has already cleared every gate.

### Near misses

Pass-or-fail rules throw away the most useful thing the forecast knows: how close a
failure was. An hour at 6.8 kt fails identically to an hour at 2 kt.

So any stretch of three or more hours that failed **exactly one** gate is reported
separately, with the gate named and the margin shown. It is never presented as
sailable. It exists because a page that is empty for a week is indistinguishable from
a page that is broken.

This is not a hypothetical nicety. Raising the precipitation limit from 20% to 30% was
decided by looking at a near miss: three hours of the best sailing day of the week were
being discarded for a 25% chance of rain. Under the stricter setting those hours did
not appear anywhere, and the day simply looked shorter than it was.

### What it deliberately ignores

- **Cloud cover** is displayed but never gates anything. Overcast and 12 kt is a good
  sailing day.
- **Wind direction** is displayed but never gates anything. Whether a direction is good
  depends on your water, and the app does not presume to know.

## Run it locally

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env     # then set NWS_CONTACT
npm run dev
```

`NWS_CONTACT` is required. The National Weather Service asks every client to identify
itself with a contact address in the User-Agent header and rejects requests that do
not. Put your own email or a URL there. The app throws a clear error at startup rather
than sending an anonymous request that NWS will refuse.

```bash
npm test          # unit tests, no network
npm run build     # production build, runs the TypeScript check
```

The test suite never hits the network. It runs against a real NWS response saved in
`tests/fixtures/`.

## Add your own spot

Add an entry to `config/spots.ts`:

```ts
{
  slug: 'your-spot',
  name: 'Your Lake',
  region: 'Your State',
  lat: 43.90234,
  lon: -73.07574,
  tz: 'America/New_York',
  wind: { minKt: 7, maxKt: 20, maxGustKt: 30 },
  precip: { maxProbability: 30 },
  window: { minHours: 3 },
  season: { start: { month: 5, day: 1 }, end: { month: 11, day: 1 } },
}
```

It appears at `/your-spot`. Everything else is derived.

### Getting the coordinates right

This is the one step worth care, and the mistake is easy to make invisibly.

**Put the point on the water, not on the shore.** The NWS forecast grid is roughly
2.5 km square. A coordinate a few hundred metres off can land in a neighbouring cell,
on the wrong side of a ridge, and the app will confidently report a forecast for the
wrong valley. This exact bug shipped here: the original Dunmore coordinate sat on land
southwest of the lake and resolved to a different grid cell than the lake's centre.

The forecast grid is resolved automatically from your lat/lon, so you never look it up
by hand. NWS limits coordinates to four decimal places and redirects requests carrying
more, which `fetch` follows transparently.

If you want the coordinate checked, give your spot an `outline` and the test suite will
assert the point falls inside it.

### Season

Defaults to May 1 through November 1, both inclusive, because Lake Dunmore freezes.
Outside the season the page still shows the forecast but suppresses the recommendation
and says why. Set it to whatever your water needs. There is no way to say "all year"
other than January 1 to December 31.

### The outline is optional

A spot may declare `outline`, a GeoJSON polygon in `data/`, which draws a small
silhouette of the water and lets the test suite verify your coordinate. Leave it out
and everything else works.

To make one, find the water on [OpenStreetMap](https://www.openstreetmap.org), note
whether it is a way or a relation, and pull its geometry from the Overpass API. Lake
Dunmore is relation 216439, made of seven outer ways that need stitching into one ring.
Expect this to take longer than you think, which is why it is optional.

## What it is not

- **Not a marine forecast.** No wave height, no water temperature, no marine warnings.
- **Not resolved to your water.** The grid is about 2.5 km square. A lake in a valley
  with a mountain beside it gets terrain smoothed away entirely. No public forecast
  resolves that, and this app does not pretend to.
- **Not a substitute for looking outside.**

## Ideas not built

- **A JSON endpoint.** The app only emits HTML. An `/api` route returning windows and
  near misses is the prerequisite for anything else on this list.
- **iOS widget.** A widget is arguably the right form factor: "can I sail today" is a
  glance, not a session. Three paths, very different costs: a native app with WidgetKit,
  a [Scriptable](https://scriptable.app) widget in JavaScript with no App Store, or a
  Shortcut. All three need the JSON endpoint first.
- **Notifications.** Sailing is intermittent, and an app you must remember to open gets
  opened twice. Being told when a window appears is more useful than being able to look
  it up.
- **Forecast stability.** Retaining each fetch would let the app show how long a window
  has survived across successive forecasts. A window seven days out is a model artifact
  as often as a plan, and today the app treats it as equally real.

## Licence

Source code is MIT. See [LICENSE](LICENSE).

Lake outlines under `data/` are **not** MIT. They come from OpenStreetMap and carry the
Open Database License, which is share-alike: redistribute them and the attribution and
the openness travel with them. Forecast data is public domain, being a work of the US
federal government.

## Built with

Next.js, TypeScript, Vitest, [suncalc](https://github.com/mourner/suncalc) for sunrise
and sunset, [OverlayScrollbars](https://kingsora.github.io/OverlayScrollbars/) for the
forecast strip. Forecast data from the US National Weather Service, a public domain US
government source. Lake outline from OpenStreetMap contributors, ODbL.
