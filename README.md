# Sail window

Tells you when the conditions are right to sail at one specific place.

A weather forecast answers "what will the weather be." That is not the question. The
question is "when this week can I actually go," which has a yes or no answer. This
reads the [Open-Meteo](https://open-meteo.com) forecast, applies a few plain rules,
and gives you the answer.

Live example: [Lake Dunmore, Vermont](https://sail-window.vercel.app/dunmore)

## Coverage is worldwide

The primary forecast comes from [Open-Meteo](https://open-meteo.com), which covers the
whole planet, needs no API key, and is free for non-commercial use. Point a spot at any
water on Earth and it works.

For US spots the [US National Weather Service](https://www.weather.gov/documentation/services-web-api)
is fetched as well and kept as a quiet second opinion. NWS gridpoint forecasts are
human-adjusted, and in sheltered valley terrain forecasters often knock the wind down
in a way that is wrong for the middle of an open lake. So when the two sources disagree
on today's peak sustained wind by 25% or more, the page names the gap in one line near
the headline, for example "NWS is lower today: peak 6 kt against Open-Meteo's 11 kt."
On ordinary days, when they agree, it says nothing.

The second opinion is US-only, because NWS covers only the US and its territories. It
requires `NWS_CONTACT` (see below) and can never break the page: if the NWS call fails,
or the spot is outside the US, the comparison line is silently omitted and the rest of
the page renders from Open-Meteo as normal.

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

### Marginal

A hard floor loses genuinely sailable days by tenths of a knot. One week Saturday peaked
at 6.8 kt against the 7 kt floor: a fourteen-hour bluebird day, no rain, gusting almost
14, rejected by two tenths. That is the wrong answer.

So there is a third tier between windows and near misses. An hour is **marginal** when it
clears every gate except sustained wind, holds at `marginalMinKt` (5 kt for Dunmore) or
above, and gusts past `marginalGustKt` (10 kt). The gust threshold is the whole point: 6
kt with no gusts is drifting, 6 kt gusting 14 is real sailing with lulls, and an average
cannot tell them apart. A run of three or more marginal hours is reported with its **peak
sustained wind** shown, because that is the number you actually judge the day by.

Marginal is never called sailable. It is the app saying "close, and gusty enough to be
real... your call, not mine." A run that qualifies as marginal is reported there and only
there, never also as a near miss.

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
cp .env.example .env     # optional: set NWS_CONTACT for the US second opinion
npm run dev
```

The primary Open-Meteo forecast needs no key and no configuration. `NWS_CONTACT` is
optional and only powers the US second opinion: the National Weather Service asks every
client to identify itself with a contact address in the User-Agent header and rejects
requests that do not, so a US spot needs it set to fetch the comparison. Leave it unset
and US spots simply skip the second opinion; spots outside the US never use it.

```bash
npm test          # unit tests, no network
npm run build     # production build, runs the TypeScript check
```

The test suite never hits the network. It runs against real Open-Meteo and NWS
responses saved in `tests/fixtures/`.

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
  wind: { minKt: 7, maxKt: 20, maxGustKt: 30, marginalMinKt: 5, marginalGustKt: 10 },
  precip: { maxProbability: 30 },
  window: { minHours: 3 },
  season: { start: { month: 5, day: 1 }, end: { month: 11, day: 1 } },
}
```

It appears at `/your-spot`. Everything else is derived.

### Getting the coordinates right

This is the one step worth care, and the mistake is easy to make invisibly.

**Put the point on the water, not on the shore.** Model grids are several kilometres
across, so a coordinate a few hundred metres off can land in a neighbouring cell, on the
wrong side of a ridge, and the app will confidently report a forecast for the wrong
valley. Models also carry land and sea masks, and surface wind over water differs from
wind over the trees beside it. This exact bug shipped here: the original Dunmore
coordinate sat on land southwest of the lake and resolved to a different NWS grid cell
than the lake's centre.

You never look a grid up by hand. Open-Meteo takes the lat/lon directly, and the NWS
second opinion resolves its own grid from the same coordinates.

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
- **Not resolved to your water.** Model grids run from roughly 3 km for high-resolution
  short-range models up to 13 km for the global ones, and Open-Meteo picks per location
  and lead time. A lake in a valley with a mountain beside it gets terrain smoothed away
  entirely at any of those scales. No public forecast resolves that, and this app does
  not pretend to.
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
the openness travel with them. Primary forecast data comes from Open-Meteo under
CC BY 4.0. The US National Weather Service second opinion is public domain, being a work
of the US federal government.

## Built with

Next.js, TypeScript, Vitest, [suncalc](https://github.com/mourner/suncalc) for sunrise
and sunset, [OverlayScrollbars](https://kingsora.github.io/OverlayScrollbars/) for the
forecast strip. Forecast data from [Open-Meteo](https://open-meteo.com), CC BY 4.0, with
the US National Weather Service as a second opinion for US spots. Lake outline from
OpenStreetMap contributors, ODbL.
