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
| Sustained wind | 5 to 20 kt | below is drifting, above stops being relaxing |
| Gusts | 30 kt ceiling | a separate field from sustained wind, and the two diverge constantly in valley terrain |
| Precipitation | under 30% chance | the forecast gives a probability, so a line has to be drawn somewhere |

Consecutive passing hours merge into a **window**. Windows shorter than three hours
are discarded, on the grounds that a shorter stretch does not justify getting the boat
out. Windows are listed in chronological order, not ranked, because every one of them
has already cleared every gate.

### Near misses

Pass-or-fail rules throw away the most useful thing the forecast knows: how close a
failure was. An hour a tenth under the floor fails identically to an hour at 2 kt.

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

## Subscribe to it as a calendar

Every spot publishes its sailable windows as an iCalendar feed at `/<slug>/calendar.ics`,
so the answer shows up next to the rest of your week instead of on a page you have to
remember to open.

```text
https://sail-window.vercel.app/dunmore/calendar.ics
```

Subscribe to it. Do not download it. A downloaded `.ics` is a snapshot, and a forecast
snapshot is wrong by dinner. A subscription is refetched, and because each fetch
replaces the whole feed, a window the model withdraws simply disappears... which is
also why there is no delete logic anywhere in `lib/ics.ts`.

**Apple Calendar** ... click **Subscribe to these windows** on the spot page, which
hands the `webcal:` URL straight to the subscribe dialog. Then set **Auto-refresh** on
the subscription; it goes down to every five minutes, and the feed advertises hourly as
a default.

**Google Calendar** ... *Other calendars* → *From URL*, and paste the `https:` URL shown
under the same link. Google polls external feeds on its own undocumented schedule,
commonly some hours, and ignores the refresh interval the feed asks for. That matters
less than it sounds: the horizon here is seven days, and a window on Thursday does not
move much in an afternoon. It does mean today's row can lag the page, so for today,
look at the page.

What the events do:

- **One timed event per window**, on the real hours, so it lands against your meetings
  rather than in the all-day strip.
- **Marked free, not busy** (`TRANSP:TRANSPARENT`). A forecast is not a commitment, and
  nobody checking your availability should see a lake blocking a Wednesday.
- **Self-describing.** Each event names the hours, the temperature, and the four gates
  it cleared, using the spot's own thresholds, so it still means something when you
  open it a week later with no page around it.
- **No alarms.** Being *notified* when a window appears is a different feature with its
  own design questions, and it is still unbuilt. See below.
- **Empty out of season**, and empty in a week with no windows. It stays a valid, named
  calendar either way, so an empty week is distinguishable from a broken feed... the
  same reason near misses exist on the page.

The feed is public, exactly as public as the page, and carries no per-user token.

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
  wind: { minKt: 5, maxKt: 20, maxGustKt: 30 },
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

- **A JSON endpoint.** The app emits HTML and iCalendar, both of them shaped for a
  particular reader. An `/api` route returning windows and near misses as plain JSON
  would serve anything that wants the data in a general form.
- **iOS widget.** A widget is arguably the right form factor: "can I sail today" is a
  glance, not a session. Three paths, very different costs: a native app with WidgetKit,
  a [Scriptable](https://scriptable.app) widget in JavaScript with no App Store, or a
  Shortcut. All three need the JSON endpoint first.
- **Notifications.** Sailing is intermittent, and an app you must remember to open gets
  opened twice. The calendar feed gets partway there, since a window lands in your week
  without you going looking for it. It cannot tell you a window has *appeared*, though.
  A subscription only shows the current answer; nothing announces that it changed.
- **Forecast stability.** Retaining each fetch would let the app show how long a window
  has survived across successive forecasts. A window seven days out is a model artifact
  as often as a plan, and today the app treats it as equally real. The calendar makes
  this visible in a way the page did not: an event five days out can shrink or vanish
  between one refresh and the next, and nothing in the feed says how many successive
  forecasts have agreed on it.
- **A maximum window length.** Windows have a floor and no ceiling, so a day that
  clears every gate from dawn to dusk becomes one thirteen-hour block. On the page that
  is a line in a list. On a calendar it is drawn to scale and reads as a commitment
  rather than an option.

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
