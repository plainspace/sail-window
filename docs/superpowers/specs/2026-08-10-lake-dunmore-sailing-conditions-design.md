# Dunmore: Lake Dunmore Sailing Conditions

**Date:** 2026-08-10
**Status:** Approved design, ready for implementation planning
**Repo:** `~/Codes/dunmore`

---

## Problem

Deciding whether to sail at Lake Dunmore, Vermont currently means reading a general
weather forecast and doing the filtering by hand, every time. The forecast answers
"what will the weather be." The actual question is "when in the next six days can I
sail," which is a different question with a yes/no answer.

This app answers that question directly: given the NWS forecast, it returns the
specific multi-hour windows that meet the sailing criteria, and nothing else.

## Scope

**In scope (v1):**

- Fetch the NWS hourly forecast for Lake Dunmore.
- Apply four hard gates to every forecast hour.
- Collapse passing hours into windows of three hours or more.
- Display qualifying windows plus an hour-by-hour grid for the full forecast horizon.
- Render a static wind map of the lake, scrubbable by hour.
- Persist every forecast fetch as an append-only snapshot.

**Out of scope (deferred to phase 2):**

- Calendar overlay. Blocking sailing windows against meetings was the original
  motivating idea and was explicitly deferred during design so v1 stays small. The
  intended source when it lands is Google Calendar private `.ics` feed URLs stored
  in env vars, polled directly. This choice was made specifically to avoid OAuth,
  a consent screen, and refresh-token maintenance for a single-user app.
- Calibration log UI. See "Phase 2" below. The v1 snapshot store exists to make it
  possible later.

**Explicitly not building:** a settings screen, user accounts, multi-location
support, or a second weather source.

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

Next.js (App Router) deployed to Vercel, public from day one. Five library modules,
three of which are pure functions with no I/O, plus one presentational component.

| Module | Responsibility | I/O |
| --- | --- | --- |
| `lib/nws.ts` | Fetch the NWS forecast, parse it, convert to knots, return `HourlyConditions[]` | network |
| `lib/daylight.ts` | Sunrise and sunset for a lat/lon/date, via `suncalc` | none |
| `lib/rules.ts` | `HourlyConditions -> Verdict`. Applies the four gates plus season | none |
| `lib/windows.ts` | Collapse passing hours into `SailWindow[]`, apply the 3-hour minimum | none |
| `lib/snapshots.ts` | Append-only persistence of each raw fetch | database |
| `components/WindMap.tsx` | Render the lake outline and wind arrows for one hour | none |

`app/page.tsx` is a server component that composes these and renders. `WindMap` is a
client component, since hour scrubbing is cursor-driven.

**`lib/nws.ts` is the only module that knows NWS exists.** Everything downstream
operates on the normalized `HourlyConditions` shape. Swapping or adding a forecast
source is a change to one file.

**The rules engine performs no I/O.** `rules.ts` and `windows.ts` are pure functions
over plain data, which makes the entire decision logic testable against saved
fixtures with no network and no database.

## Data model

```ts
type HourlyConditions = {
  startTime: string        // ISO 8601 with offset, as returned by NWS
  windKt: number           // sustained, converted from NWS mph
  gustKt: number | null    // null when NWS omits gust data for the hour
  windDirection: string    // cardinal, e.g. "NW"
  windDirectionDeg: number
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
}

type ForecastSnapshot = {
  fetchedAt: string
  payload: unknown         // raw NWS response, unmodified
}
```

`Verdict` collects **all** failing reasons rather than short-circuiting on the first,
so the UI can explain precisely why an hour was rejected.

`gustKt` is nullable by design, and a missing gust value must stay distinguishable
from a gust of zero. See the gust risk below.

**A null gust does not veto the hour.** NWS routinely omits gust data when gusts are
unremarkable, so treating null as a failure would delete most otherwise-good hours.
Null is treated as "no gust reported" and the hour is judged on its other three
gates. The window list marks any window containing a null-gust hour so the missing
data is visible rather than silently assumed benign. This is the one place the rules
are permissive rather than conservative, and it is a deliberate trade: the
alternative makes the app useless.

## NWS integration

Endpoint chain: `/points/{lat},{lon}` resolves the grid office and coordinates, then
`/gridpoints/{office}/{x},{y}/forecast/hourly` returns the hourly series. The horizon
is approximately 156 hours (about six and a half days).

### Verified-unknown items

These were not confirmed against the live API during design, because network access
was unavailable. Each must be checked as the first implementation step, and the
first is load-bearing.

1. **`windGust` may not appear on the hourly forecast endpoint.** Gust data is
   believed to live on the raw `/gridpoints/{office}/{x},{y}` time-series rather than
   on `/forecast/hourly`. If confirmed, the fetch layer must request both and join on
   timestamp. Confidence: moderate. **The gust veto depends entirely on this**, so it
   is the first thing to verify before any other work.
2. **`windSpeed` is a string, and may be a range.** NWS returns values like
   `"10 mph"` but also `"5 to 10 mph"`. The parser must handle both. For a range, the
   whole range must satisfy the gate: test the **lower** bound against the 7 kt
   minimum and the **upper** bound against the 20 kt maximum. So `"5 to 10 mph"`
   fails as too light, and `"15 to 25 kt"` fails as too strong. An ambiguous forecast
   never produces a qualifying hour.
3. **NWS rejects requests without a `User-Agent` header** carrying contact
   information. Confidence: high.
4. **Units.** NWS returns mph or km/h depending on request parameters. Conversion to
   knots happens once, in `lib/nws.ts`, at the boundary. Nothing downstream sees any
   other unit.
5. **Lake Dunmore coordinates** are approximately 43.885 N, -73.085 W. Confidence:
   moderate. Confirm before baking in, since the grid cell is about 2.5 km and a bad
   coordinate silently forecasts the wrong valley.

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

## UI

One page, no navigation, no settings.

**Window list.** The qualifying windows for the forecast horizon, each showing day,
time range, duration, wind range in knots, direction, and average temperature.

Windows are ordered **chronologically, soonest first**. They are deliberately not
ranked by quality, because the rules engine produces no quality score. Every window
in the list has already passed every gate, so they are equally valid and the only
meaningful ordering is when they occur.

**Wind map.** A static drawing of Lake Dunmore with wind arrows across it, plus a
compass rose and the knot reading for the hour being shown. Hovering an hour in the
grid redraws the map for that hour, so the wind can be watched swinging across a day.
Defaults to the currently-selected window when the cursor is elsewhere.

**Hour grid.** Below the windows, a compact grid covering the full horizon, one cell
per hour, colored by pass or fail. Hovering a failed cell shows its `FailReason`
list, so it is always visible why a promising-looking hour was rejected.

Thresholds are a config constant, not a UI control. Retuning is a code edit.

### Wind map implementation

Inline SVG. No map library, no tile server, no API key, no runtime network request.
The lake outline is traced once from OpenStreetMap, committed to the repo as
`data/lake-dunmore.geojson`, and projected to SVG path coordinates at build time.
Non-scrollable and non-zoomable by construction, since it is a drawing rather than a
map viewport.

Arrows are laid out on a fixed grid clipped to the lake polygon, all rotated to the
forecast direction, with arrow length scaled to wind speed in knots.

The outline is sourced once, by hand, from the OpenStreetMap water relation for Lake
Dunmore via Overpass, simplified, and committed. It is a static asset and is never
fetched at runtime. OpenStreetMap data is ODbL licensed, so attribution belongs in
the page footer.

**The arrows are uniform across the lake, and this is deliberate.** NWS provides a
single reading from one grid cell roughly 2.5 km across, which is larger than the
lake. There is no spatial variation in the underlying data, so none is drawn.
Rendering divergent arrows, or interpolating a field from a single sample, would
fabricate resolution the source does not have.

What the map legitimately shows is **wind direction relative to the lake's axis**.
Dunmore runs roughly north-south, so a northerly or southerly reads immediately as
full-fetch and an easterly or westerly reads as coming over the ridge. That
orientation judgment is the entire purpose of the drawing, and it is also the visual
counterpart to the direction question that phase 2's calibration log is meant to
answer with data.

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
- A `"5 to 10 mph"` range string parsed at both bounds.
- A DST transition day, verifying no duplicated or missing hour.
- Dates on either side of May 1 and November 1.
- Wind direction to SVG rotation: all eight cardinals map to the correct on-screen
  angle, with north up. This is the one place an off-by-180 error is both easy to
  make and invisible on inspection, since a wrong arrow still looks like an arrow.
- Arrow rendering for an hour with a null or zero wind reading.

## Phase 2: calibration log

Recorded here so v1 does not foreclose it, and because the v1 snapshot store exists
solely to serve it.

After sailing, observed conditions at the lake are recorded and stored against the
forecast snapshot for that hour. Accumulated over a season, this yields:

- **Bias correction.** If NWS systematically over-forecasts wind at this sheltered
  lake, the magnitude becomes measurable and the gates can be shifted to match.
- **A direction answer.** Whether wind direction actually predicts sailing quality at
  Dunmore, settled with recorded observations rather than reasoning from terrain.
- **Hit rate.** The fraction of recommended windows that were genuinely good, which
  is the only real measure of whether this app works.

Phase 2 adds a write path and a form. It does not change the v1 rules engine.

## Open items

None. Season boundaries, snapshot timing, and calibration scope were all resolved
during design. The five NWS integration unknowns above are implementation
verification steps, not unresolved design decisions.
