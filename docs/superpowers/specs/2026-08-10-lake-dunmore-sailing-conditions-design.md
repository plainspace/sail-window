# Dunmore: Lake Dunmore Sailing Conditions

**Date:** 2026-08-10
**Status:** Approved design, ready for implementation planning
**Repo:** `~/Codes/dunmore`

---

## Problem

Deciding whether to sail at Lake Dunmore, Vermont currently means reading a general
weather forecast and doing the filtering by hand, every time. The forecast answers
"what will the weather be." The actual question is "when in the next week can I
sail," which is a different question with a yes/no answer.

This app answers that question directly: given the NWS forecast, it returns the
specific multi-hour windows that meet the sailing criteria. Everything else it shows
exists to qualify that answer, not to expand it: how far the wind blows over water,
how stable the forecast has been, and what nearly qualified but did not.

## Scope

**In scope (v1):**

- Fetch the NWS hourly forecast for Lake Dunmore.
- Apply four hard gates to every forecast hour, within the sailing season.
- Collapse passing hours into windows of three hours or more.
- Answer the question in one sentence at the top of the page.
- Display qualifying windows plus an hour-by-hour grid for the full forecast horizon.
- Compute over-water fetch length for each window from the lake geometry.
- Render a static wind map of the lake, scrubbable by hour, showing the fetch line.
- Show near misses: days that failed exactly one gate, and by how much.
- Persist every forecast fetch as an append-only snapshot.
- Show how long each window has persisted across successive forecasts.

**Out of scope (deferred to phase 2):**

- Calibration log UI. See "Phase 2" below. The v1 snapshot store exists to make it
  possible later.
- Push notifications. Deferred as a new delivery surface rather than because the idea
  is weak. See "Phase 2" for the argument that it may be the highest-value addition
  to the whole project.

**Explicitly not building:** a settings screen, user accounts, multi-location
support, or a second weather source.

**Cut on 2026-08-10:** the calendar overlay. Blocking sailing windows against
meetings was the original motivating idea for this app, and it is now dropped
entirely rather than deferred. The app is a weather filter; scheduling stays out of
it. This is recorded rather than deleted silently, because the problem statement of
the whole project began as "weather plus calendar" and a future reader will otherwise
wonder where the calendar went.

## The rules

An hour passes only if **all four** gates hold. There is no scoring, no weighting,
and no partial credit. An hour either qualifies or it does not.

| Gate | Rule | Source field |
| --- | --- | --- |
| Daylight | timestamp falls between sunrise and sunset at the lake | computed locally |
| Sustained wind | 7 kt ≤ speed ≤ 20 kt | NWS `windSpeed` |
| Gusts | gust ≤ 30 kt | NWS `windGust` |
| Precipitation | probability < 20% | NWS `probabilityOfPrecipitation` |

Consecutive passing hours are collapsed into a window. **Windows shorter than three
contiguous hours are discarded** on the grounds that a shorter stretch does not
justify rigging, sailing, and derigging.

### Deliberately excluded from the rules

- **Cloud cover.** Dropped from the model entirely. "Sun" in the original request
  meant daylight hours, not clear skies. An overcast 14 kt hour is a good sailing
  hour and is treated as one.
- **Wind direction.** Carried through the pipeline and displayed on every window,
  but never used as a filter. Any wind direction is sailable on this lake.

Direction is displayed rather than dropped because it is the most likely candidate
for a future rule, and phase 2's calibration log is the mechanism for finding out
empirically whether it deserves to be one.

### Near misses

Binary gates discard the most useful thing the forecast knows: **how close a failure
was**. An hour at 6.8 kt fails identically to an hour at 2 kt. A day that failed only
on 22% precipitation is a completely different day from one that failed on dead air,
and the current rules render them the same way: absent.

The app therefore surfaces a **near miss** for any run of three or more contiguous
daylight hours that failed **exactly one** gate, showing which gate and by how much.

This is not scoring reintroduced through the back door. There are no weights, no
tunable importance, and no combined number. A near miss never appears in the window
list and is never presented as sailable. It is presented as information about why a
day was rejected, in a separate section, visually subordinate.

It exists because the gates are strict in combination, and a page that is empty for a
week is indistinguishable from a page that is broken. The near-miss list is what
makes an empty result legible rather than alarming.

`Verdict` already collects every failing reason rather than short-circuiting, so the
data required is a by-product of work the rules engine is doing anyway.

## Fetch length

For each hour, the app computes the **over-water fetch**: the distance the wind
travels across open water before it reaches the downwind shore. This is derived by
casting a ray through the lake polygon along the wind vector and measuring the chord
of water it crosses.

Fetch depends on where on the lake you are, and the app does not know that. It
therefore reports the chord through the widest part of the lake along that direction,
which is the maximum available fetch for that wind. This is stated rather than
smoothed over: it is an upper bound, not a reading at a point.

Lake Dunmore runs roughly north-south, about three miles on its long axis and a few
hundred yards across. A northerly or southerly therefore delivers well over a mile of
fetch; an easterly or westerly delivers a few hundred yards. Fetch is the single
largest driver of wave development and wind steadiness, so this one derived number
explains more about what the day will feel like on the water than direction alone.

**Why this is legitimate and uniform wind arrows are not.** Fetch is *geometry*,
computed from a lake outline we possess and a direction the forecast gives us. It
invents nothing. Drawing a spatially varying wind field, by contrast, would require
meteorological resolution the source does not have. The distinction matters, and it
is the reason the map draws one fetch line and many identical arrows rather than the
reverse.

Fetch is displayed, never gated. It does not filter any hour.

## Season

The app operates from **May 1 through November 1, both dates inclusive**. November 2
is out of season.

This gate exists because Lake Dunmore freezes and the NWS forecast has no concept of
ice. Without it, a January afternoon at 12 kt sustained, gusts 22, 10% precipitation
probability and five hours of daylight passes every gate cleanly and ranks first.

Outside the season the app does not hide data. It renders the same forecast grid with
an "off season" banner, so the information remains available and only the
recommendation is suppressed.

Season boundaries are a single exported constant, expressed as month/day pairs so
they carry across years without edit.

## Architecture

Next.js (App Router) deployed to Vercel, public from day one. Six library modules,
four of which are pure functions with no I/O, plus one presentational component.

| Module | Responsibility | I/O |
| --- | --- | --- |
| `lib/nws.ts` | Fetch the NWS forecast, parse it, convert to knots, return `HourlyConditions[]` | network |
| `lib/daylight.ts` | Sunrise and sunset for a lat/lon/date, via `suncalc` | none |
| `lib/rules.ts` | `HourlyConditions -> Verdict`. Applies the four gates plus season | none |
| `lib/windows.ts` | Collapse passing hours into `SailWindow[]`, apply the 3-hour minimum | none |
| `lib/geometry.ts` | Ray-cast a wind direction across the lake polygon to get fetch length | none |
| `lib/snapshots.ts` | Append-only persistence of each raw fetch, and stability diffing | database |
| `components/WindMap.tsx` | Render the lake outline, wind arrows, and fetch line for one hour | none |

`app/page.tsx` is a server component that composes these and renders. `WindMap` is a
client component, since hour scrubbing is cursor-driven.

**`lib/nws.ts` is the only module that knows NWS exists.** Everything downstream
operates on the normalized `HourlyConditions` shape. Swapping or adding a forecast
source is a change to one file.

**The rules engine performs no I/O.** `rules.ts`, `windows.ts`, `geometry.ts`, and
`daylight.ts` are pure functions over plain data, which makes the entire decision
logic, including fetch computation, testable against saved fixtures with no network
and no database. Only `nws.ts` and `snapshots.ts` touch the outside world.

## Data model

```ts
type HourlyConditions = {
  startTime: string        // ISO 8601 with offset, as returned by NWS
  windKt: number           // sustained, converted from NWS mph
  gustKt: number | null    // null when NWS omits gust data for the hour
  windDirectionDeg: number // from NWS, degrees
  windDirection: string    // cardinal, e.g. "NW"; derived by this app from degrees
  precipProbability: number // 0-100
  temperatureF: number
}

type Verdict =
  | { pass: true }
  | { pass: false; reasons: FailReason[] }

type FailReason =
  | 'dark' | 'wind-too-light' | 'wind-too-strong'
  | 'gusty' | 'precip' | 'off-season'

type SailWindow = {
  start: string
  end: string
  hours: number
  windKtMin: number
  windKtMax: number
  directions: string[]     // distinct directions across the window
  temperatureFAvg: number
  fetchMetersMin: number   // shortest over-water fetch across the window's directions
  fetchMetersMax: number
  hasUnknownGust: boolean  // true if any hour had gustKt === null
  stability: Stability | null  // null until at least two snapshots exist
}

type Stability = {
  firstSeenAt: string      // when this window first appeared in any forecast
  forecastsSeen: number    // how many consecutive forecasts have contained it
}

type NearMiss = {
  start: string
  end: string
  hours: number            // contiguous hours that failed on this one gate alone
  reason: FailReason       // the single gate that failed
  margin: string           // human-readable, e.g. "0.2 kt short", "precip 22%"
}

type ForecastSnapshot = {
  fetchedAt: string
  payload: unknown         // raw NWS response, unmodified
  windowCount: number      // qualifying windows this forecast produced
  qualifyingHours: number  // qualifying hours this forecast produced
}
```

`Verdict` collects **all** failing reasons rather than short-circuiting on the first,
so the UI can explain precisely why an hour was rejected.

`gustKt` is nullable by design, and a missing gust value must stay distinguishable
from a gust of zero. See the gust risk below.

**A null gust does not veto the hour.** Null is treated as "no gust reported" and the
hour is judged on its other three gates. The window list marks any window containing
a null-gust hour so the missing data is visible rather than silently assumed benign.

**Correction, 2026-08-10.** An earlier draft justified this rule by asserting that
"NWS routinely omits gust data when gusts are unremarkable." That is false, and it
was never checked. Measured against the real fixture: `windSpeed` expands to 181
hours, `windGust` expands to 181 hours, and the set difference in both directions is
zero. Gust coverage is complete for every forecast hour.

The rule stands anyway, as defensive handling of a field the API is not contractually
obliged to provide, but its real justification is much weaker than claimed: the null
case has simply never been observed. Because real data cannot reach that branch, it
is covered by a synthetic input in the test suite rather than by the fixture, and the
suite separately pins the observed fact that the fixture has full coverage. If that
pin ever fails, NWS behaviour has changed and this rule needs revisiting.

## NWS integration

**Verified against the live API on 2026-08-10.** The findings below are observed, not
assumed, and two of them changed the design.

### Endpoint

`/points/43.885,-73.085` resolves to grid **BTV/97,30** and reports
`timeZone: "America/New_York"` and a `relativeLocation` of 7.2 km north of Brandon,
VT, which confirms the coordinates land on the right valley.

The app then uses **one endpoint only**: the raw gridpoint time-series at
`/gridpoints/BTV/97,30`. The `/forecast/hourly` endpoint is **not used**.

### Why the raw gridpoint rather than /forecast/hourly

`/forecast/hourly` was the original plan. It is the wrong choice, for three observed
reasons:

1. **It has no gusts at all.** `windGust` appears in zero of its 156 periods. The
   gust veto is impossible on that endpoint.
2. **Its wind direction is a cardinal string** (`"S"`). Fetch ray-casting needs an
   angle. The raw gridpoint gives numeric degrees directly.
3. **Its wind speed is a formatted string** (`"7 mph"`, sometimes `"5 to 10 mph"`).
   The raw gridpoint gives numbers.

The raw gridpoint carries every field the app needs, so using it removes a second
request, removes all string parsing, and removes the entire class of range-string
ambiguity that an earlier draft of this spec devoted a rule to. It also has a longer
horizon.

### Observed shape

| Property | Unit | Entries |
| --- | --- | --- |
| `temperature` | `wmoUnit:degC` | 159 |
| `probabilityOfPrecipitation` | `wmoUnit:percent` | 52 |
| `windSpeed` | `wmoUnit:km_h-1` | 67 |
| `windGust` | `wmoUnit:km_h-1` | 102 |
| `windDirection` | `wmoUnit:degree_(angle)` | 81 |

Horizon is `validTimes: "2026-08-10T12:00:00+00:00/P7DT13H"`, about 181 hours.

**Values are run-length encoded, not hourly.** Each entry is
`{ validTime: "<ISO instant>/<ISO duration>", value: <number> }`, for example
`"2026-08-10T15:00:00+00:00/PT5H"`. Observed durations in one sample ran PT1H through
PT9H. The differing entry counts per property in the table above are a direct
consequence: each property is encoded independently, so **the properties do not share
a timeline** and cannot be zipped positionally.

`lib/nws.ts` therefore expands every property into a dense hourly map keyed by UTC
hour, then joins the properties on that key. The parser must handle general ISO 8601
durations including a day component (`P1DT6H`), since longer runs appear further out
in the horizon even though this sample topped out at PT9H.

### Units

The gridpoint returns SI. Conversion happens once, in `lib/nws.ts`, at the boundary:
km/h to knots (divide by 1.852) and Celsius to Fahrenheit. Nothing downstream sees
any other unit.

`windDirection` arrives as degrees. The cardinal label shown in the UI is **derived by
this app** from the angle, not supplied by NWS.

### Request requirements

NWS rejects requests lacking a `User-Agent` header carrying contact information.
Confirmed: requests sent with `dunmore-sailing-app (jaredvolpe@gmail.com)` succeed.

### Caching

NWS asks clients not to poll aggressively. The forecast is revalidated on a 30 to 60
minute interval. All hours are computed in `America/New_York`, using an IANA zone
rather than a fixed offset so DST transitions are handled correctly.

### Accuracy caveat, recorded deliberately

No public forecast model resolves Lake Dunmore's local wind. The lake sits in a
valley with Mount Moosalamoo on its east side, and terrain at that scale is smoothed
away by a 2.5 km grid. The nearest real observation sites, Middlebury State (6B0,
roughly 8 miles northwest) and Rutland (KRUT, roughly 20 miles south), are poor
proxies for a sheltered valley lake and are not used.

This is a known and accepted limitation of v1, not a defect to be solved with a
better feed. The intended remedy is phase 2's calibration log, which measures the
local bias empirically instead of modeling it.

## Persistence

Every forecast fetch is written to an append-only snapshot store, retaining the raw
NWS payload unmodified.

**Why this is in v1 rather than phase 2:** calibration requires comparing what
actually happened against *what the forecast said at the time*. A system that only
ever fetches live data and discards the previous response cannot be calibrated
retroactively. Deferring snapshots to phase 2 means phase 2 opens with an empty
table and a meaningful bias estimate is a full season away from that date. Writing
snapshots from v1 costs a small store and no UI, and banks the data in the meantime.

**Store:** Turso (libSQL). Chosen because it is SQLite, matching the pattern already
used in `stock-monitor-dashboard` and `lead-monitor`, and because it works from
Vercel serverless functions without connection-pool management. Vercel Postgres is
the fallback if Turso proves awkward.

**Write trigger:** write-through on forecast revalidation. Each time the cached
forecast expires and is refetched, that response is snapshotted. This requires no
cron job and no additional infrastructure.

A single daily Vercel cron acts as a floor, guaranteeing at least one snapshot per
day during stretches when the page goes unvisited. One cron per day is what the
Vercel hobby tier allows, so this floor is free.

### Forecast stability

Each window is diffed against the windows derived from prior snapshots. A window that
has survived several successive forecasts is far more trustworthy than one that
appeared in the last refresh, and the app says so.

This matters because **the design otherwise treats hour 6 and hour 140 as equally
real**, which they are not. A window seven days out is a model artifact as often as it
is a plan. Stability is the correction, and it is the honest one: rather than
inventing a confidence percentage, it reports an observable fact about how the
forecast has actually behaved.

A window is matched across snapshots by overlapping time range on the same date, not
by exact equality, so a window that shifts by an hour or grows by one is recognised as
the same window rather than a new one.

Display is a badge on each window: "in every forecast for 3 days" versus "new in this
forecast." Windows with no prior snapshots to compare against carry no badge at all
rather than a misleading one, which is why `Stability` is nullable.

**This is also what makes v1 persistence pay for itself immediately.** Storage
justified solely by an unbuilt phase 2 feature is a smell; stability makes the
snapshot store useful on day two, and the calibration log then inherits a store that
already exists and is already full.

## UI

One page, no navigation, no settings.

**Headline.** One sentence in large type at the top, answering the question directly:
*"Next window: Thursday 1pm, 4 hours, 12 to 15 kt N."* Or, equally prominently,
*"Nothing sailable in the next week."* Everything below it is supporting evidence.

The question this app exists to answer is one line long, and a page that opens with
three components instead of one answer has made the reader do the summarising. The
zero case gets the same treatment as the positive case, deliberately: a confident
"no" is a useful answer and must not look like a page that failed to load.

**Window list.** The qualifying windows for the forecast horizon, each showing day,
time range, duration, wind range in knots, direction, average temperature, fetch, and
a stability badge.

Windows are ordered **chronologically, soonest first**. They are deliberately not
ranked by quality, because the rules engine produces no quality score. Every window
in the list has already passed every gate, so they are equally valid and the only
meaningful ordering is when they occur.

**Wind map.** A static drawing of Lake Dunmore with wind arrows across it, the fetch
line drawn across the water with its length labeled, a compass rose, and the knot
reading for the hour being shown. Hovering an hour in the grid redraws the map for
that hour, so the wind can be watched swinging across a day, with the fetch line
swinging and changing length as it does. Defaults to the currently-selected window
when the cursor is elsewhere.

**Hour grid.** Below the windows, a compact grid covering the full horizon, one cell
per hour, colored by pass or fail. Hovering a failed cell shows its `FailReason`
list, so it is always visible why a promising-looking hour was rejected.

**Near misses.** Below the grid, visually subordinate to the window list: runs of
three or more hours that failed exactly one gate, with the gate named and the margin
shown. Never styled as an opportunity, never mixed into the window list.

Thresholds are a config constant, not a UI control. Retuning is a code edit.

### Wind map implementation

Inline SVG. No map library, no tile server, no API key, no runtime network request.
Non-scrollable and non-zoomable by construction, since it is a drawing rather than a
map viewport.

The outline is sourced once, by hand, from the OpenStreetMap water relation for Lake
Dunmore via Overpass, simplified, and committed as `data/lake-dunmore.geojson`. It is
projected to SVG path coordinates at build time, and is never fetched at runtime.
OpenStreetMap data is ODbL licensed, so attribution belongs in the page footer.

The same polygon is the input to `lib/geometry.ts`, so the shape drawn on screen and
the shape fetch is computed from are guaranteed to be the same shape.

Arrows are laid out on a fixed grid clipped to the lake polygon, all rotated to the
forecast direction, with arrow length scaled to wind speed in knots.

**The arrows are uniform across the lake, and this is deliberate.** NWS provides a
single reading from one grid cell roughly 2.5 km across, which is larger than the
lake. There is no spatial variation in the underlying data, so none is drawn.
Rendering divergent arrows, or interpolating a field from a single sample, would
fabricate resolution the source does not have.

What the map legitimately shows is **wind direction relative to the lake's axis, and
the fetch that follows from it**. Dunmore runs roughly north-south, so a northerly or
southerly reads immediately as full-fetch and an easterly or westerly reads as coming
over the ridge. The fetch line makes that judgment quantitative rather than
impressionistic: it is drawn across the water along the wind vector and labeled with
its length.

So the map carries exactly one piece of real spatial information, and it is the piece
we can actually derive. The arrows orient you; the fetch line is the data. This is
also the visual counterpart to the direction question that phase 2's calibration log
is meant to answer with recorded observations.

## Configuration

All tunable values live in one exported object so they can be adjusted without
touching logic:

```ts
export const CONFIG = {
  location: { lat: 43.885, lon: -73.085, tz: 'America/New_York' },
  wind: { minKt: 7, maxKt: 20, maxGustKt: 30 },
  precip: { maxProbability: 20 },
  window: { minHours: 3 },
  season: { start: { month: 5, day: 1 }, end: { month: 11, day: 1 } },
}
```

## Testing

Fixture-based, with no live network calls in the test suite. One real NWS response is
saved as a fixture and the pure modules are tested against it.

Required boundary cases:

- Wind exactly 7 kt and exactly 20 kt (both pass; the gates are inclusive).
- Gust exactly 30 kt (passes) and 31 kt (fails).
- Precipitation probability exactly 20% (fails; the gate is strictly less than).
- A two-hour qualifying run (discarded) against a three-hour run (kept).
- A window running into sunset, truncated at the sunset hour.
- An hour with `gustKt: null` passes on its other three gates, is not treated as a
  gust of zero, and is flagged in the window it belongs to.
- Run-length expansion: a `PT5H` entry becomes five identical hourly values, and a
  `P1DT6H` entry becomes thirty.
- Two properties with different entry counts and different interval boundaries join
  correctly on the hour, since NWS encodes each property on its own timeline.
- An hour covered by `windSpeed` but not by `windGust` yields `gustKt: null` rather
  than dropping the hour or borrowing a neighbouring gust value.
- A DST transition day, verifying no duplicated or missing hour.
- Dates on either side of May 1 and November 1.
- Wind direction to SVG rotation: all eight cardinals map to the correct on-screen
  angle, with north up. This is the one place an off-by-180 error is both easy to
  make and invisible on inspection, since a wrong arrow still looks like an arrow.
- Arrow rendering for an hour with a null or zero wind reading.
- **Zero-window state.** A forecast in which nothing qualifies produces the confident
  "nothing sailable" headline, an empty window list, and a populated near-miss
  section. This state is expected to be common and must be tested as a first-class
  result, not treated as an error path.
- Near miss fires only when exactly one gate failed, and never when two or more did.
- A near-miss run shorter than three hours is not reported.
- Fetch geometry: a northerly on a north-south lake returns a long chord, an easterly
  returns a short one, and a ray cast from outside the polygon does not crash.
- Fetch across a concave section of the outline returns the water distance, not the
  straight-line distance through land.
- Stability matching: a window that shifts by one hour between snapshots is matched as
  the same window, not counted as new.
- Stability is null, and no badge renders, when only one snapshot exists.

## Observability

From the first deploy, each snapshot records **the number of qualifying windows and
qualifying hours** it produced.

This exists to settle a specific open question rather than to fill a dashboard. The
four gates are individually reasonable and may be strict in combination: a Vermont
summer afternoon routinely carries a precipitation probability above 20%, and
requiring that alongside sustained 7 to 20 kt, gusts under 30, and three consecutive
daylight hours may qualify far fewer hours than expected.

The prediction on record is that **a meaningful share of days will produce zero
windows**. Logging the count from day one makes that checkable against real data
within a week. If it holds, the precipitation gate is the first thing to loosen,
because it is the gate most likely to be binding and the one whose threshold is least
grounded in sailing and most grounded in convention.

Without this counter the question stays a matter of opinion for an entire season.

## Phase 2: calibration log

Recorded here so v1 does not foreclose it. The v1 snapshot store already earns its
place through forecast stability; the calibration log is the second thing it enables,
and it inherits a store that is already running and already full.

After sailing, observed conditions at the lake are recorded and stored against the
forecast snapshot for that hour. Accumulated over a season, this yields:

- **Bias correction.** If NWS systematically over-forecasts wind at this sheltered
  lake, the magnitude becomes measurable and the gates can be shifted to match.
- **A direction answer.** Whether wind direction actually predicts sailing quality at
  Dunmore, settled with recorded observations rather than reasoning from terrain.
- **Hit rate.** The fraction of recommended windows that were genuinely good, which
  is the only real measure of whether this app works.

Phase 2 adds a write path and a form. It does not change the v1 rules engine.

### Phase 2: push notifications

Recorded because deferring it was a scheduling decision, not a judgment that it is
unimportant.

Sailing is intermittent, and an app for an intermittent activity that must be
remembered and opened tends to be opened twice and then bookmarked forever. The
forecast improving on a Thursday is precisely the moment nobody is sitting at a
browser. A pull-only interface therefore has a structural problem that no amount of
UI quality fixes.

The remedy is small: one cron, one webhook to ntfy or Pushover, one message of the
form "Thu 1 to 5pm, 4 hrs, 12 to 15 kt N, fetch 1.4 mi." The `Stability` data already
provides the signal for when a window is worth interrupting someone over, so the
notification can wait until a window has survived two forecasts rather than firing on
every model wobble.

This is plausibly the highest-value single addition to the project, and it is
deliberately not in v1 only because it introduces a delivery surface, a subscription
secret, and a spam-avoidance policy that deserve their own design pass.

## Open items

None. Season boundaries, snapshot timing, and calibration scope were resolved during
design. The NWS integration unknowns were resolved on 2026-08-10 by calling the live
API; the endpoint choice, units, encoding, and coordinates in this spec are observed
rather than assumed.
