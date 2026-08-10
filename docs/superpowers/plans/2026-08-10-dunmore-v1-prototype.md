# Dunmore v1 Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-running Next.js app that reads the NWS gridpoint forecast for Lake Dunmore, applies four hard gates plus a season gate, and shows the multi-hour windows when sailing is possible.

**Architecture:** One network module (`lib/nws.ts`) normalises the NWS run-length-encoded gridpoint response into a dense hourly array. Four pure modules (`daylight`, `rules`, `windows`, `geometry`) turn that array into windows, near misses, and fetch lengths with no I/O. One persistence module appends forecast snapshots to a local SQLite file. A single server component composes them.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Vitest, `suncalc`, `@libsql/client` (local file mode), inline SVG. Package manager: **npm**.

## Global Constraints

- **Data source is `https://api.weather.gov/gridpoints/BTV/97,30`.** Never `/forecast/hourly`, which has no `windGust`, gives wind direction as a cardinal string, and gives wind speed as a formatted string.
- **Every NWS request MUST send** `User-Agent: dunmore-sailing-app (jaredvolpe@gmail.com)`. Requests without it are rejected.
- **NWS `windDirection` is the direction the wind blows FROM** (meteorological convention). A wind arrow depicting motion points toward `deg + 180`.
- **Gridpoint values are run-length encoded** as `{ validTime: "<ISO instant>/<ISO duration>", value: number }`. Each property has its own independent timeline. **Never zip properties positionally.**
- **Units at the boundary only.** NWS gives km/h and Celsius. `lib/nws.ts` converts to knots (`kmh / 1.852`) and Fahrenheit. No other module sees any other unit.
- **Gates:** daylight, `7 <= windKt <= 20` inclusive, `gustKt <= 30`, `precipProbability < 20`. Season May 1 through November 1, both inclusive.
- **Minimum window: 3 contiguous hours.** Same minimum applies to near misses.
- **A null gust never vetoes an hour.** It is not zero and it is not a failure.
- **Timezone is `America/New_York`** via IANA zone, never a fixed offset.
- **No em dashes in any user-facing copy.** Use ellipses.

---

### Task 1: Scaffold, config, and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `lib/config.ts`
- Create: `app/layout.tsx`, `app/page.tsx`
- Test: `lib/config.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `CONFIG` with `location {lat, lon, tz}`, `wind {minKt, maxKt, maxGustKt}`, `precip {maxProbability}`, `window {minHours}`, `season {start:{month,day}, end:{month,day}}`, `nws {gridpointUrl, userAgent}`

- [ ] **Step 1: Scaffold Next.js**

```bash
cd /Users/borrowers/Codes/dunmore
npx create-next-app@latest . --typescript --app --no-tailwind --no-eslint --no-src-dir --import-alias "@/*" --use-npm
```

Answer "yes" to proceeding in a non-empty directory. Keep existing `docs/` and `tests/`.

- [ ] **Step 2: Add test dependencies**

```bash
npm install -D vitest @vitejs/plugin-react
npm install suncalc @libsql/client
npm install -D @types/suncalc
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Write the failing test**

`lib/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CONFIG } from './config'

describe('CONFIG', () => {
  it('encodes the approved gate thresholds', () => {
    expect(CONFIG.wind).toEqual({ minKt: 7, maxKt: 20, maxGustKt: 30 })
    expect(CONFIG.precip.maxProbability).toBe(20)
    expect(CONFIG.window.minHours).toBe(3)
  })

  it('runs May 1 through November 1', () => {
    expect(CONFIG.season.start).toEqual({ month: 5, day: 1 })
    expect(CONFIG.season.end).toEqual({ month: 11, day: 1 })
  })

  it('points at the verified BTV gridpoint', () => {
    expect(CONFIG.nws.gridpointUrl).toBe('https://api.weather.gov/gridpoints/BTV/97,30')
    expect(CONFIG.nws.userAgent).toContain('dunmore-sailing-app')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `./config`.

- [ ] **Step 6: Write `lib/config.ts`**

```ts
export const CONFIG = {
  location: { lat: 43.885, lon: -73.085, tz: 'America/New_York' },
  wind: { minKt: 7, maxKt: 20, maxGustKt: 30 },
  precip: { maxProbability: 20 },
  window: { minHours: 3 },
  season: { start: { month: 5, day: 1 }, end: { month: 11, day: 1 } },
  nws: {
    gridpointUrl: 'https://api.weather.gov/gridpoints/BTV/97,30',
    userAgent: 'dunmore-sailing-app (jaredvolpe@gmail.com)',
  },
} as const
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with config and vitest harness"
```

---

### Task 2: NWS gridpoint parser

The most important task. Everything downstream depends on this shape being right.

**Files:**
- Create: `lib/nws.ts`
- Test: `lib/nws.test.ts`
- Uses: `tests/fixtures/gridpoint-btv-97-30-2026-08-10.json` (already committed, a real response)

**Interfaces:**
- Consumes: `CONFIG.nws` from Task 1
- Produces:
  - `type HourlyConditions = { startTime: string; windKt: number; gustKt: number | null; windDirectionDeg: number; windDirection: string; precipProbability: number; temperatureF: number }`
  - `parseGridpoint(json: unknown): HourlyConditions[]` (pure)
  - `durationToHours(iso: string): number` (pure, exported for test)
  - `degreesToCardinal(deg: number): string` (pure, exported for test)
  - `fetchForecast(): Promise<{ raw: unknown; hours: HourlyConditions[] }>` (network)

- [ ] **Step 1: Write the failing test**

`lib/nws.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseGridpoint, durationToHours, degreesToCardinal } from './nws'

const fixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../tests/fixtures/gridpoint-btv-97-30-2026-08-10.json'),
    'utf8',
  ),
)

describe('durationToHours', () => {
  it('parses hour-only durations', () => {
    expect(durationToHours('PT1H')).toBe(1)
    expect(durationToHours('PT9H')).toBe(9)
  })

  it('parses durations with a day component', () => {
    expect(durationToHours('P1DT6H')).toBe(30)
    expect(durationToHours('P2D')).toBe(48)
  })

  it('throws on an unparseable duration rather than guessing', () => {
    expect(() => durationToHours('banana')).toThrow()
  })
})

describe('degreesToCardinal', () => {
  it('maps the eight cardinals', () => {
    expect(degreesToCardinal(0)).toBe('N')
    expect(degreesToCardinal(45)).toBe('NE')
    expect(degreesToCardinal(90)).toBe('E')
    expect(degreesToCardinal(135)).toBe('SE')
    expect(degreesToCardinal(180)).toBe('S')
    expect(degreesToCardinal(225)).toBe('SW')
    expect(degreesToCardinal(270)).toBe('W')
    expect(degreesToCardinal(315)).toBe('NW')
  })

  it('wraps 360 back to north', () => {
    expect(degreesToCardinal(360)).toBe('N')
  })
})

describe('parseGridpoint', () => {
  const hours = parseGridpoint(fixture)

  it('expands run-length encoding into dense hourly rows', () => {
    expect(hours.length).toBeGreaterThan(150)
  })

  it('produces strictly increasing, gapless hourly timestamps', () => {
    for (let i = 1; i < hours.length; i++) {
      const prev = Date.parse(hours[i - 1].startTime)
      const cur = Date.parse(hours[i].startTime)
      expect(cur - prev).toBe(3600_000)
    }
  })

  it('converts km/h to knots', () => {
    // fixture windSpeed starts at 5.556 km/h == 3.0 kt
    expect(hours[0].windKt).toBeCloseTo(3.0, 1)
  })

  it('converts Celsius to Fahrenheit into a plausible August range', () => {
    for (const h of hours) {
      expect(h.temperatureF).toBeGreaterThan(20)
      expect(h.temperatureF).toBeLessThan(110)
    }
  })

  it('carries numeric degrees and a derived cardinal', () => {
    expect(typeof hours[0].windDirectionDeg).toBe('number')
    expect(hours[0].windDirection).toMatch(/^[NSEW]{1,3}$/)
  })

  it('keeps precip probability as a percentage', () => {
    for (const h of hours) {
      expect(h.precipProbability).toBeGreaterThanOrEqual(0)
      expect(h.precipProbability).toBeLessThanOrEqual(100)
    }
  })

  it('represents a missing gust as null, never as zero', () => {
    for (const h of hours) {
      expect(h.gustKt === null || h.gustKt > 0).toBe(true)
    }
  })

  it('joins properties on the hour rather than by position', () => {
    // windSpeed has 67 entries and windGust has 102 in this fixture.
    // A positional zip would misalign; an hour-keyed join cannot.
    const gusty = hours.filter((h) => h.gustKt !== null)
    expect(gusty.length).toBeGreaterThan(50)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/nws.test.ts`
Expected: FAIL, cannot resolve `./nws`.

- [ ] **Step 3: Write `lib/nws.ts`**

```ts
import { CONFIG } from './config'

export type HourlyConditions = {
  startTime: string
  windKt: number
  gustKt: number | null
  windDirectionDeg: number
  windDirection: string
  precipProbability: number
  temperatureF: number
}

type NwsValue = { validTime: string; value: number | null }
type NwsSeries = { uom?: string; values: NwsValue[] }

const HOUR_MS = 3600_000

export function durationToHours(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso)
  if (!m || iso === 'P') throw new Error(`Unparseable ISO duration: ${iso}`)
  const days = Number(m[1] ?? 0)
  const hours = Number(m[2] ?? 0)
  const total = days * 24 + hours
  if (total < 1) throw new Error(`Duration shorter than one hour: ${iso}`)
  return total
}

export function degreesToCardinal(deg: number): string {
  const names = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ]
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16
  return names[idx]
}

/** Expand one run-length-encoded series into a map keyed by UTC hour. */
function expand(series: NwsSeries | undefined): Map<string, number> {
  const out = new Map<string, number>()
  if (!series) return out
  for (const { validTime, value } of series.values) {
    if (value === null) continue
    const [instant, duration] = validTime.split('/')
    const start = Date.parse(instant)
    const span = durationToHours(duration)
    for (let i = 0; i < span; i++) {
      out.set(new Date(start + i * HOUR_MS).toISOString(), value)
    }
  }
  return out
}

const kmhToKt = (kmh: number) => kmh / 1.852
const cToF = (c: number) => (c * 9) / 5 + 32

export function parseGridpoint(json: unknown): HourlyConditions[] {
  const p = (json as { properties: Record<string, NwsSeries> }).properties
  const speed = expand(p.windSpeed)
  const gust = expand(p.windGust)
  const dir = expand(p.windDirection)
  const pop = expand(p.probabilityOfPrecipitation)
  const temp = expand(p.temperature)

  const rows: HourlyConditions[] = []
  for (const key of [...speed.keys()].sort()) {
    const d = dir.get(key)
    const pr = pop.get(key)
    const t = temp.get(key)
    // Require every gate input. Gust is the only optional field.
    if (d === undefined || pr === undefined || t === undefined) continue
    const g = gust.get(key)
    rows.push({
      startTime: key,
      windKt: kmhToKt(speed.get(key)!),
      gustKt: g === undefined ? null : kmhToKt(g),
      windDirectionDeg: d,
      windDirection: degreesToCardinal(d),
      precipProbability: pr,
      temperatureF: cToF(t),
    })
  }
  return rows
}

export async function fetchForecast(): Promise<{ raw: unknown; hours: HourlyConditions[] }> {
  const res = await fetch(CONFIG.nws.gridpointUrl, {
    headers: { 'User-Agent': CONFIG.nws.userAgent, Accept: 'application/geo+json' },
    next: { revalidate: 1800 },
  })
  if (!res.ok) throw new Error(`NWS returned ${res.status} ${res.statusText}`)
  const raw = await res.json()
  return { raw, hours: parseGridpoint(raw) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test lib/nws.test.ts`
Expected: PASS, all cases.

If "gapless hourly timestamps" fails, the cause is a genuine hole in the NWS `windSpeed` coverage. Do not paper over it by interpolating. Change the test to assert monotonic increase and log the gap count, and record the finding in the spec.

- [ ] **Step 5: Commit**

```bash
git add lib/nws.ts lib/nws.test.ts
git commit -m "Add NWS gridpoint parser with run-length expansion and unit conversion"
```

---

### Task 3: Daylight

**Files:**
- Create: `lib/daylight.ts`
- Test: `lib/daylight.test.ts`

**Interfaces:**
- Consumes: `CONFIG.location`
- Produces: `isDaylight(iso: string): boolean`, `sunTimes(date: Date): { sunrise: Date; sunset: Date }`

The NWS `/points` response for 2026-08-10 reported `sunrise 2026-08-10T05:51:08-04:00` and `sunset 2026-08-10T20:04:14-04:00`. That is an independent oracle for `suncalc`, so the test uses it.

- [ ] **Step 1: Write the failing test**

`lib/daylight.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sunTimes, isDaylight } from './daylight'

describe('sunTimes', () => {
  it('matches the sunrise and sunset NWS reported for 2026-08-10', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-08-10T12:00:00Z'))
    const nwsSunrise = Date.parse('2026-08-10T05:51:08-04:00')
    const nwsSunset = Date.parse('2026-08-10T20:04:14-04:00')
    // Within two minutes of the official value.
    expect(Math.abs(sunrise.getTime() - nwsSunrise)).toBeLessThan(120_000)
    expect(Math.abs(sunset.getTime() - nwsSunset)).toBeLessThan(120_000)
  })
})

describe('isDaylight', () => {
  it('accepts midday and rejects the small hours', () => {
    expect(isDaylight('2026-08-10T16:00:00Z')).toBe(true)  // noon ET
    expect(isDaylight('2026-08-10T07:00:00Z')).toBe(false) // 3am ET
  })

  it('rejects an hour just before sunrise and accepts one just after', () => {
    expect(isDaylight('2026-08-10T09:00:00Z')).toBe(false) // 5am ET
    expect(isDaylight('2026-08-10T11:00:00Z')).toBe(true)  // 7am ET
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/daylight.test.ts`
Expected: FAIL, cannot resolve `./daylight`.

- [ ] **Step 3: Write `lib/daylight.ts`**

```ts
import SunCalc from 'suncalc'
import { CONFIG } from './config'

export function sunTimes(date: Date): { sunrise: Date; sunset: Date } {
  const t = SunCalc.getTimes(date, CONFIG.location.lat, CONFIG.location.lon)
  return { sunrise: t.sunrise, sunset: t.sunset }
}

/** True when the given instant falls between sunrise and sunset at the lake. */
export function isDaylight(iso: string): boolean {
  const at = new Date(iso)
  const { sunrise, sunset } = sunTimes(at)
  return at >= sunrise && at <= sunset
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test lib/daylight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daylight.ts lib/daylight.test.ts
git commit -m "Add daylight gate validated against NWS-reported sun times"
```

---

### Task 4: Rules engine

**Files:**
- Create: `lib/rules.ts`
- Test: `lib/rules.test.ts`

**Interfaces:**
- Consumes: `HourlyConditions` (Task 2), `isDaylight` (Task 3), `CONFIG`
- Produces:
  - `type FailReason = 'dark' | 'wind-too-light' | 'wind-too-strong' | 'gusty' | 'precip' | 'off-season'`
  - `type Verdict = { pass: true } | { pass: false; reasons: FailReason[] }`
  - `judge(h: HourlyConditions): Verdict`
  - `inSeason(iso: string): boolean`

- [ ] **Step 1: Write the failing test**

`lib/rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { judge, inSeason } from './rules'
import type { HourlyConditions } from './nws'

// 2026-08-15T16:00:00Z is noon ET, in season, in daylight.
const base: HourlyConditions = {
  startTime: '2026-08-15T16:00:00Z',
  windKt: 12,
  gustKt: 18,
  windDirectionDeg: 180,
  windDirection: 'S',
  precipProbability: 5,
  temperatureF: 75,
}
const at = (over: Partial<HourlyConditions>) => judge({ ...base, ...over })

describe('wind gates', () => {
  it('accepts the inclusive bounds', () => {
    expect(at({ windKt: 7 }).pass).toBe(true)
    expect(at({ windKt: 20 }).pass).toBe(true)
  })

  it('rejects just outside the bounds with the right reason', () => {
    expect(at({ windKt: 6.9 })).toEqual({ pass: false, reasons: ['wind-too-light'] })
    expect(at({ windKt: 20.1 })).toEqual({ pass: false, reasons: ['wind-too-strong'] })
  })
})

describe('gust gate', () => {
  it('accepts exactly 30 and rejects 31', () => {
    expect(at({ gustKt: 30 }).pass).toBe(true)
    expect(at({ gustKt: 31 })).toEqual({ pass: false, reasons: ['gusty'] })
  })

  it('never vetoes on a null gust', () => {
    expect(at({ gustKt: null }).pass).toBe(true)
  })
})

describe('precip gate', () => {
  it('is strictly less than the threshold', () => {
    expect(at({ precipProbability: 19 }).pass).toBe(true)
    expect(at({ precipProbability: 20 })).toEqual({ pass: false, reasons: ['precip'] })
  })
})

describe('reason collection', () => {
  it('reports every failing gate, not just the first', () => {
    const v = at({ windKt: 2, precipProbability: 90 })
    expect(v.pass).toBe(false)
    if (!v.pass) {
      expect(v.reasons).toContain('wind-too-light')
      expect(v.reasons).toContain('precip')
    }
  })
})

describe('season', () => {
  it('includes both boundary days', () => {
    expect(inSeason('2026-05-01T16:00:00Z')).toBe(true)
    expect(inSeason('2026-11-01T16:00:00Z')).toBe(true)
  })

  it('excludes the days outside', () => {
    expect(inSeason('2026-04-30T16:00:00Z')).toBe(false)
    expect(inSeason('2026-11-02T16:00:00Z')).toBe(false)
  })

  it('rejects a perfect January afternoon on the frozen lake', () => {
    const v = judge({ ...base, startTime: '2026-01-15T17:00:00Z', temperatureF: 34 })
    expect(v.pass).toBe(false)
    if (!v.pass) expect(v.reasons).toContain('off-season')
  })
})

describe('daylight', () => {
  it('rejects the middle of the night', () => {
    const v = judge({ ...base, startTime: '2026-08-15T07:00:00Z' })
    expect(v.pass).toBe(false)
    if (!v.pass) expect(v.reasons).toContain('dark')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/rules.test.ts`
Expected: FAIL, cannot resolve `./rules`.

- [ ] **Step 3: Write `lib/rules.ts`**

```ts
import { CONFIG } from './config'
import { isDaylight } from './daylight'
import type { HourlyConditions } from './nws'

export type FailReason =
  | 'dark' | 'wind-too-light' | 'wind-too-strong'
  | 'gusty' | 'precip' | 'off-season'

export type Verdict = { pass: true } | { pass: false; reasons: FailReason[] }

/** Month/day comparison in the lake's local timezone, both bounds inclusive. */
export function inSeason(iso: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.location.tz,
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(iso))
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)
  const key = month * 100 + day
  const { start, end } = CONFIG.season
  return key >= start.month * 100 + start.day && key <= end.month * 100 + end.day
}

export function judge(h: HourlyConditions): Verdict {
  const reasons: FailReason[] = []
  if (!inSeason(h.startTime)) reasons.push('off-season')
  if (!isDaylight(h.startTime)) reasons.push('dark')
  if (h.windKt < CONFIG.wind.minKt) reasons.push('wind-too-light')
  if (h.windKt > CONFIG.wind.maxKt) reasons.push('wind-too-strong')
  // A null gust is unknown, not zero, and never vetoes.
  if (h.gustKt !== null && h.gustKt > CONFIG.wind.maxGustKt) reasons.push('gusty')
  if (h.precipProbability >= CONFIG.precip.maxProbability) reasons.push('precip')
  return reasons.length === 0 ? { pass: true } : { pass: false, reasons }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test lib/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rules.ts lib/rules.test.ts
git commit -m "Add rules engine with four gates plus season"
```

---

### Task 5: Windows and near misses

**Files:**
- Create: `lib/windows.ts`
- Test: `lib/windows.test.ts`

**Interfaces:**
- Consumes: `HourlyConditions`, `judge`, `FailReason`, `CONFIG.window.minHours`
- Produces:
  - `type SailWindow = { start: string; end: string; hours: number; windKtMin: number; windKtMax: number; directions: string[]; temperatureFAvg: number; hasUnknownGust: boolean }`
  - `type NearMiss = { start: string; end: string; hours: number; reason: FailReason; margin: string }`
  - `buildWindows(hours: HourlyConditions[]): SailWindow[]`
  - `buildNearMisses(hours: HourlyConditions[]): NearMiss[]`

`SailWindow` here omits `fetchMetersMin`/`fetchMetersMax` and `stability`; those are attached in Tasks 6 and 7 respectively.

- [ ] **Step 1: Write the failing test**

`lib/windows.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildWindows, buildNearMisses } from './windows'
import type { HourlyConditions } from './nws'

const HOUR = 3600_000
// 2026-08-15T14:00:00Z is 10am ET, safely inside daylight and season.
const START = Date.parse('2026-08-15T14:00:00Z')

function run(n: number, over: Partial<HourlyConditions> = {}, offset = 0): HourlyConditions[] {
  return Array.from({ length: n }, (_, i) => ({
    startTime: new Date(START + (i + offset) * HOUR).toISOString(),
    windKt: 12,
    gustKt: 18,
    windDirectionDeg: 180,
    windDirection: 'S',
    precipProbability: 5,
    temperatureF: 75,
    ...over,
  }))
}

describe('buildWindows', () => {
  it('keeps a three-hour run', () => {
    const w = buildWindows(run(3))
    expect(w).toHaveLength(1)
    expect(w[0].hours).toBe(3)
  })

  it('discards a two-hour run', () => {
    expect(buildWindows(run(2))).toHaveLength(0)
  })

  it('splits on a failing hour rather than bridging it', () => {
    const hours = [...run(3), ...run(1, { windKt: 2 }, 3), ...run(3, {}, 4)]
    const w = buildWindows(hours)
    expect(w).toHaveLength(2)
  })

  it('summarises wind range, directions, and temperature', () => {
    const hours = [
      ...run(1, { windKt: 9, windDirection: 'S' }),
      ...run(1, { windKt: 15, windDirection: 'SW' }, 1),
      ...run(1, { windKt: 12, windDirection: 'S' }, 2),
    ]
    const [w] = buildWindows(hours)
    expect(w.windKtMin).toBe(9)
    expect(w.windKtMax).toBe(15)
    expect(w.directions).toEqual(['S', 'SW'])
    expect(w.temperatureFAvg).toBe(75)
  })

  it('flags a window containing an hour with an unknown gust', () => {
    const hours = [...run(2), ...run(1, { gustKt: null }, 2)]
    expect(buildWindows(hours)[0].hasUnknownGust).toBe(true)
  })

  it('returns nothing when nothing qualifies', () => {
    expect(buildWindows(run(12, { windKt: 2 }))).toEqual([])
  })
})

describe('buildNearMisses', () => {
  it('reports a run that failed exactly one gate', () => {
    const misses = buildNearMisses(run(4, { precipProbability: 22 }))
    expect(misses).toHaveLength(1)
    expect(misses[0].reason).toBe('precip')
    expect(misses[0].hours).toBe(4)
    expect(misses[0].margin).toContain('22')
  })

  it('ignores a run that failed two gates', () => {
    expect(buildNearMisses(run(4, { precipProbability: 22, windKt: 2 }))).toEqual([])
  })

  it('ignores a near-miss run shorter than the minimum', () => {
    expect(buildNearMisses(run(2, { precipProbability: 22 }))).toEqual([])
  })

  it('does not report hours that actually qualify', () => {
    expect(buildNearMisses(run(5))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/windows.test.ts`
Expected: FAIL, cannot resolve `./windows`.

- [ ] **Step 3: Write `lib/windows.ts`**

```ts
import { CONFIG } from './config'
import { judge, type FailReason } from './rules'
import type { HourlyConditions } from './nws'

export type SailWindow = {
  start: string
  end: string
  hours: number
  windKtMin: number
  windKtMax: number
  directions: string[]
  temperatureFAvg: number
  hasUnknownGust: boolean
}

export type NearMiss = {
  start: string
  end: string
  hours: number
  reason: FailReason
  margin: string
}

const HOUR_MS = 3600_000
const endOf = (h: HourlyConditions) => new Date(Date.parse(h.startTime) + HOUR_MS).toISOString()

/** Group consecutive hours sharing a key, discarding groups below minHours. */
function runs<T>(items: T[], key: (t: T) => string | null): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let curKey: string | null = null
  for (const it of items) {
    const k = key(it)
    if (k !== null && k === curKey) cur.push(it)
    else {
      if (cur.length >= CONFIG.window.minHours) out.push(cur)
      cur = k === null ? [] : [it]
      curKey = k
    }
  }
  if (cur.length >= CONFIG.window.minHours) out.push(cur)
  return out
}

export function buildWindows(hours: HourlyConditions[]): SailWindow[] {
  return runs(hours, (h) => (judge(h).pass ? 'pass' : null)).map((group) => ({
    start: group[0].startTime,
    end: endOf(group[group.length - 1]),
    hours: group.length,
    windKtMin: Math.min(...group.map((h) => h.windKt)),
    windKtMax: Math.max(...group.map((h) => h.windKt)),
    directions: [...new Set(group.map((h) => h.windDirection))],
    temperatureFAvg:
      Math.round(group.reduce((s, h) => s + h.temperatureF, 0) / group.length),
    hasUnknownGust: group.some((h) => h.gustKt === null),
  }))
}

function marginFor(reason: FailReason, h: HourlyConditions): string {
  switch (reason) {
    case 'wind-too-light':
      return `${(CONFIG.wind.minKt - h.windKt).toFixed(1)} kt short`
    case 'wind-too-strong':
      return `${(h.windKt - CONFIG.wind.maxKt).toFixed(1)} kt over`
    case 'gusty':
      return `gusts ${Math.round(h.gustKt ?? 0)} kt`
    case 'precip':
      return `precip ${Math.round(h.precipProbability)}%`
    default:
      return ''
  }
}

/** Runs of hours that failed exactly one gate, and the same gate throughout. */
export function buildNearMisses(hours: HourlyConditions[]): NearMiss[] {
  const soleReason = (h: HourlyConditions): string | null => {
    const v = judge(h)
    if (v.pass) return null
    return v.reasons.length === 1 ? v.reasons[0] : null
  }
  return runs(hours, soleReason).map((group) => {
    const reason = soleReason(group[0]) as FailReason
    return {
      start: group[0].startTime,
      end: endOf(group[group.length - 1]),
      hours: group.length,
      reason,
      margin: marginFor(reason, group[0]),
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test lib/windows.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add lib/windows.ts lib/windows.test.ts
git commit -m "Add window collapsing and near-miss detection"
```

---

### Task 6: Page, headline, and the first thing you can actually look at

This is the task that makes the app runnable. Do it before geometry and snapshots so there is something on screen early.

**Files:**
- Modify: `app/page.tsx`
- Create: `app/dunmore.css`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `fetchForecast` (Task 2), `buildWindows`, `buildNearMisses` (Task 5), `judge` (Task 4)
- Produces: a rendered page. No exports consumed by later tasks.

- [ ] **Step 1: Write `app/page.tsx`**

```tsx
import { fetchForecast } from '@/lib/nws'
import { buildWindows, buildNearMisses } from '@/lib/windows'
import { judge } from '@/lib/rules'
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

  return (
    <main>
      <h1 className="headline">
        {next
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
```

- [ ] **Step 2: Write `app/dunmore.css`**

```css
:root { color-scheme: light dark; --fg: #111; --quiet: #666; --pass: #2f7d32; --fail: #d8d8d8; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #eee; --quiet: #999; --pass: #6fcf74; --fail: #333; }
}
body { background: canvas; color: var(--fg); font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem; }
.headline { font-size: clamp(1.5rem, 4vw, 2.25rem); line-height: 1.2; margin: 0 0 2.5rem; }
h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--quiet); margin: 2.5rem 0 0.75rem; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 0.4rem 0; border-bottom: 1px solid color-mix(in srgb, var(--quiet) 25%, transparent); }
.quiet { color: var(--quiet); }
.flag { color: #b8860b; font-size: 0.85em; }
.grid { display: flex; flex-wrap: wrap; gap: 2px; }
.cell { width: 10px; height: 18px; border-radius: 2px; background: var(--fail); }
.cell.pass { background: var(--pass); }
.misses li { opacity: 0.75; }
```

- [ ] **Step 3: Replace `app/layout.tsx`**

```tsx
export const metadata = { title: 'Dunmore', description: 'When can I sail at Lake Dunmore' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

Delete `app/globals.css` and `app/page.module.css` if `create-next-app` generated them.

- [ ] **Step 3b: Add the off-season banner**

The spec requires that outside May 1 to November 1 the app still shows the forecast
data but suppresses the recommendation. Without this, the page silently renders an
empty window list all winter and looks broken rather than closed.

In `app/page.tsx`, import `inSeason` from `@/lib/rules` and add above the headline:

```tsx
const openNow = inSeason(new Date().toISOString())
```

Then render the banner, and gate only the headline's positive case on it:

```tsx
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
```

Add to `app/dunmore.css`:

```css
.offseason { border-left: 3px solid #b8860b; padding: 0.5rem 0.9rem; margin: 0 0 1.5rem; color: var(--quiet); }
```

Note that `judge` already fails every out-of-season hour with `off-season`, so the
window list and grid need no change. This step only affects presentation.

- [ ] **Step 4: Run it**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: a headline, a window list (possibly empty), a strip of hour cells, and a near-miss list. **Confirm the page renders real data, not an error.** If the gate results look implausible, read the hour-cell tooltips before changing any threshold.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "Add page with headline, window list, hour grid, and near misses"
```

---

### Task 7: Lake polygon and fetch geometry

**Files:**
- Create: `data/lake-dunmore.geojson`
- Create: `lib/geometry.ts`
- Test: `lib/geometry.test.ts`

**Interfaces:**
- Consumes: `CONFIG.location`
- Produces:
  - `type LatLon = [number, number]` (lon, lat, GeoJSON order)
  - `loadLakePolygon(): LatLon[]`
  - `fetchMeters(bearingDeg: number, polygon?: LatLon[]): number`

- [ ] **Step 1: Fetch the lake outline from OpenStreetMap**

```bash
curl -s -X POST -H "User-Agent: dunmore-sailing-app (jaredvolpe@gmail.com)" \
  --data-urlencode 'data=[out:json];way["natural"="water"]["name"="Lake Dunmore"](43.83,-73.13,43.94,-73.03);out geom;' \
  https://overpass-api.de/api/interpreter \
  -o /tmp/dunmore-osm.json
```

Then convert to a minimal GeoJSON polygon:

```bash
python3 -c "
import json
d=json.load(open('/tmp/dunmore-osm.json'))
ways=[e for e in d['elements'] if e.get('geometry')]
w=max(ways,key=lambda e:len(e['geometry']))
coords=[[p['lon'],p['lat']] for p in w['geometry']]
out={'type':'Feature','properties':{'name':'Lake Dunmore','source':'OpenStreetMap contributors, ODbL'},'geometry':{'type':'Polygon','coordinates':[coords]}}
json.dump(out,open('/Users/borrowers/Codes/dunmore/data/lake-dunmore.geojson','w'))
print('vertices:',len(coords))
"
```

Expected: a few hundred vertices. If the query returns nothing, widen the bounding box or drop the `name` filter and inspect what comes back before proceeding.

- [ ] **Step 2: Write the failing test**

`lib/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadLakePolygon, fetchMeters } from './geometry'

const poly = loadLakePolygon()

describe('loadLakePolygon', () => {
  it('loads a closed ring with real vertices', () => {
    expect(poly.length).toBeGreaterThan(20)
    for (const [lon, lat] of poly) {
      expect(lon).toBeLessThan(-72.9)
      expect(lon).toBeGreaterThan(-73.2)
      expect(lat).toBeGreaterThan(43.8)
      expect(lat).toBeLessThan(44.0)
    }
  })
})

describe('fetchMeters', () => {
  const northSouth = fetchMeters(0)
  const eastWest = fetchMeters(90)

  it('gives a longer fetch along the lake axis than across it', () => {
    expect(northSouth).toBeGreaterThan(eastWest * 2)
  })

  it('returns a plausible magnitude for a three-mile lake', () => {
    expect(northSouth).toBeGreaterThan(1500)
    expect(northSouth).toBeLessThan(8000)
  })

  it('is direction-agnostic, since a fetch line is an axis', () => {
    expect(fetchMeters(0)).toBeCloseTo(fetchMeters(180), 0)
    expect(fetchMeters(90)).toBeCloseTo(fetchMeters(270), 0)
  })

  it('handles wrapped and negative bearings', () => {
    expect(fetchMeters(360)).toBeCloseTo(fetchMeters(0), 0)
    expect(fetchMeters(-90)).toBeCloseTo(fetchMeters(270), 0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test lib/geometry.test.ts`
Expected: FAIL, cannot resolve `./geometry`.

- [ ] **Step 4: Write `lib/geometry.ts`**

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config'

export type LatLon = [number, number] // [lon, lat], GeoJSON order

let cached: LatLon[] | null = null

export function loadLakePolygon(): LatLon[] {
  if (cached) return cached
  const file = path.resolve(process.cwd(), 'data/lake-dunmore.geojson')
  const gj = JSON.parse(readFileSync(file, 'utf8'))
  cached = gj.geometry.coordinates[0] as LatLon[]
  return cached
}

/** Equirectangular projection to metres, accurate enough over a 3 mile lake. */
function toMeters(poly: LatLon[]): [number, number][] {
  const R = 6371000
  const lat0 = (CONFIG.location.lat * Math.PI) / 180
  return poly.map(([lon, lat]) => [
    ((lon * Math.PI) / 180) * R * Math.cos(lat0),
    ((lat * Math.PI) / 180) * R,
  ])
}

/** Total length of polygon interior along one infinite line, via crossings. */
function chordOnLine(
  pts: [number, number][],
  origin: [number, number],
  dir: [number, number],
): number {
  const [dx, dy] = dir
  // Perpendicular offset of each vertex from the line, and along-line coordinate.
  const ts: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const sa = (a[0] - origin[0]) * -dy + (a[1] - origin[1]) * dx
    const sb = (b[0] - origin[0]) * -dy + (b[1] - origin[1]) * dx
    if (sa === sb) continue
    if (sa > 0 === sb > 0) continue // no crossing
    const f = sa / (sa - sb)
    const px = a[0] + (b[0] - a[0]) * f
    const py = a[1] + (b[1] - a[1]) * f
    ts.push((px - origin[0]) * dx + (py - origin[1]) * dy)
  }
  if (ts.length < 2) return 0
  ts.sort((m, n) => m - n)
  // Pair crossings: inside spans are between successive pairs.
  let total = 0
  for (let i = 0; i + 1 < ts.length; i += 2) total += ts[i + 1] - ts[i]
  return total
}

/**
 * Maximum over-water fetch along the given bearing, in metres.
 * A fetch line is an axis, so bearing and bearing+180 give the same answer.
 */
export function fetchMeters(bearingDeg: number, polygon?: LatLon[]): number {
  const pts = toMeters(polygon ?? loadLakePolygon())
  const rad = (((bearingDeg % 360) + 360) % 360) * (Math.PI / 180)
  // Bearing 0 = north = +y. Bearing 90 = east = +x.
  const dir: [number, number] = [Math.sin(rad), Math.cos(rad)]
  const perp: [number, number] = [-dir[1], dir[0]]

  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
  const offsets = pts.map((p) => (p[0] - cx) * perp[0] + (p[1] - cy) * perp[1])
  const lo = Math.min(...offsets)
  const hi = Math.max(...offsets)

  // Sample parallel lines across the lake; keep the longest water crossing.
  const SAMPLES = 200
  let best = 0
  for (let i = 1; i < SAMPLES; i++) {
    const off = lo + ((hi - lo) * i) / SAMPLES
    const origin: [number, number] = [cx + perp[0] * off, cy + perp[1] * off]
    best = Math.max(best, chordOnLine(pts, origin, dir))
  }
  return best
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test lib/geometry.test.ts`
Expected: PASS.

If "longer along the axis" fails, print `fetchMeters` at every 15 degrees and check the maximum lands near 0/180. A maximum near 90/270 means the `dir` vector has x and y swapped.

- [ ] **Step 6: Attach fetch to windows**

In `lib/windows.ts`, extend `SailWindow` with `fetchMetersMin: number` and `fetchMetersMax: number`, and inside `buildWindows` compute:

```ts
const fetches = group.map((h) => fetchMeters(h.windDirectionDeg))
// add to the returned object:
fetchMetersMin: Math.round(Math.min(...fetches)),
fetchMetersMax: Math.round(Math.max(...fetches)),
```

Import `fetchMeters` from `./geometry`. Add to `lib/windows.test.ts`:

```ts
it('attaches a positive fetch range to a window', () => {
  const [w] = buildWindows(run(3))
  expect(w.fetchMetersMin).toBeGreaterThan(0)
  expect(w.fetchMetersMax).toBeGreaterThanOrEqual(w.fetchMetersMin)
})
```

- [ ] **Step 7: Show fetch in the window list**

In `app/page.tsx`, inside the window `<li>`, append to the quiet span:

```tsx
{' · fetch '}{(w.fetchMetersMax / 1609).toFixed(1)} mi
```

- [ ] **Step 8: Run the full suite and the dev server**

Run: `npm test` then `npm run dev`
Expected: tests PASS; window rows now show a fetch distance in miles.

- [ ] **Step 9: Commit**

```bash
git add data/ lib/geometry.ts lib/geometry.test.ts lib/windows.ts lib/windows.test.ts app/page.tsx
git commit -m "Add lake polygon and over-water fetch computation"
```

---

### Task 8: Snapshots and forecast stability

**Files:**
- Create: `lib/snapshots.ts`
- Test: `lib/snapshots.test.ts`
- Modify: `app/page.tsx`, `.gitignore`, `.env.example`

**Interfaces:**
- Consumes: `SailWindow` (Task 5)
- Produces:
  - `type Stability = { firstSeenAt: string; forecastsSeen: number }`
  - `saveSnapshot(raw: unknown, windowCount: number, qualifyingHours: number): Promise<void>`
  - `attachStability(windows: SailWindow[]): Promise<(SailWindow & { stability: Stability | null })[]>`

- [ ] **Step 1: Add local database config**

Append to `.gitignore`:

```
*.db
*.db-*
.env
```

Create `.env.example`:

```
# Local prototype uses an on-disk SQLite file. Swap to a Turso URL to host.
DATABASE_URL=file:./dunmore.db
```

Create `.env` with the same content. **Never commit `.env`.**

- [ ] **Step 2: Write the failing test**

`lib/snapshots.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { rmSync } from 'node:fs'
import { saveSnapshot, attachStability, _resetForTests } from './snapshots'
import type { SailWindow } from './windows'

const w = (start: string, end: string): SailWindow => ({
  start, end, hours: 3, windKtMin: 10, windKtMax: 14,
  directions: ['S'], temperatureFAvg: 75, hasUnknownGust: false,
  fetchMetersMin: 1000, fetchMetersMax: 2000,
})

beforeEach(async () => {
  try { rmSync('./dunmore-test.db') } catch {}
  await _resetForTests()
})

describe('stability', () => {
  it('is null when only one snapshot exists', async () => {
    await saveSnapshot({}, 1, 3)
    const [out] = await attachStability([w('2026-08-15T14:00:00Z', '2026-08-15T17:00:00Z')])
    expect(out.stability).toBeNull()
  })

  it('counts a window that persists across snapshots', async () => {
    const win = w('2026-08-15T14:00:00Z', '2026-08-15T17:00:00Z')
    await saveSnapshot({}, 1, 3)
    await attachStability([win])
    await saveSnapshot({}, 1, 3)
    const [out] = await attachStability([win])
    expect(out.stability?.forecastsSeen).toBeGreaterThanOrEqual(2)
  })

  it('matches a window that shifted by one hour as the same window', async () => {
    await saveSnapshot({}, 1, 3)
    await attachStability([w('2026-08-15T14:00:00Z', '2026-08-15T17:00:00Z')])
    await saveSnapshot({}, 1, 3)
    const [out] = await attachStability([w('2026-08-15T15:00:00Z', '2026-08-15T18:00:00Z')])
    expect(out.stability).not.toBeNull()
  })

  it('treats a window on a different day as new', async () => {
    await saveSnapshot({}, 1, 3)
    await attachStability([w('2026-08-15T14:00:00Z', '2026-08-15T17:00:00Z')])
    await saveSnapshot({}, 1, 3)
    const [out] = await attachStability([w('2026-08-18T14:00:00Z', '2026-08-18T17:00:00Z')])
    expect(out.stability?.forecastsSeen ?? 1).toBe(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test lib/snapshots.test.ts`
Expected: FAIL, cannot resolve `./snapshots`.

- [ ] **Step 4: Write `lib/snapshots.ts`**

```ts
import { createClient, type Client } from '@libsql/client'
import type { SailWindow } from './windows'

export type Stability = { firstSeenAt: string; forecastsSeen: number }

let client: Client | null = null

function db(): Client {
  if (client) return client
  const url = process.env.NODE_ENV === 'test'
    ? 'file:./dunmore-test.db'
    : process.env.DATABASE_URL ?? 'file:./dunmore.db'
  client = createClient({ url })
  return client
}

let ready: Promise<void> | null = null
function migrate(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      window_count INTEGER NOT NULL,
      qualifying_hours INTEGER NOT NULL
    )`)
    await db().execute(`CREATE TABLE IF NOT EXISTS window_sightings (
      day TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_snapshot_id INTEGER NOT NULL,
      forecasts_seen INTEGER NOT NULL,
      PRIMARY KEY (day, start_ms)
    )`)
  })()
  return ready
}

export async function _resetForTests(): Promise<void> {
  client = null
  ready = null
  await migrate()
  await db().execute('DELETE FROM snapshots')
  await db().execute('DELETE FROM window_sightings')
}

export async function saveSnapshot(
  raw: unknown,
  windowCount: number,
  qualifyingHours: number,
): Promise<void> {
  await migrate()
  await db().execute({
    sql: 'INSERT INTO snapshots (fetched_at, payload, window_count, qualifying_hours) VALUES (?, ?, ?, ?)',
    args: [new Date().toISOString(), JSON.stringify(raw), windowCount, qualifyingHours],
  })
}

const dayOf = (iso: string) => iso.slice(0, 10)

export async function attachStability(
  windows: SailWindow[],
): Promise<(SailWindow & { stability: Stability | null })[]> {
  await migrate()
  const snap = await db().execute('SELECT MAX(id) AS id, COUNT(*) AS n FROM snapshots')
  const snapshotId = Number(snap.rows[0]?.id ?? 0)
  const totalSnapshots = Number(snap.rows[0]?.n ?? 0)

  const out: (SailWindow & { stability: Stability | null })[] = []
  for (const w of windows) {
    const day = dayOf(w.start)
    const startMs = Date.parse(w.start)
    const endMs = Date.parse(w.end)
    // Match on same day with any temporal overlap, so a shifted window is the same window.
    const prior = await db().execute({
      sql: `SELECT start_ms, first_seen_at, forecasts_seen, last_snapshot_id
            FROM window_sightings
            WHERE day = ? AND start_ms < ? AND end_ms > ?
            ORDER BY forecasts_seen DESC LIMIT 1`,
      args: [day, endMs, startMs],
    })
    const row = prior.rows[0]
    const firstSeenAt = (row?.first_seen_at as string) ?? new Date().toISOString()
    const alreadyCountedThisSnapshot = Number(row?.last_snapshot_id ?? -1) === snapshotId
    const seen = row
      ? Number(row.forecasts_seen) + (alreadyCountedThisSnapshot ? 0 : 1)
      : 1

    await db().execute({
      sql: `INSERT INTO window_sightings (day, start_ms, end_ms, first_seen_at, last_snapshot_id, forecasts_seen)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(day, start_ms) DO UPDATE SET
              end_ms = excluded.end_ms,
              last_snapshot_id = excluded.last_snapshot_id,
              forecasts_seen = excluded.forecasts_seen`,
      args: [day, startMs, endMs, firstSeenAt, snapshotId, seen],
    })

    out.push({
      ...w,
      stability: totalSnapshots < 2 ? null : { firstSeenAt, forecastsSeen: seen },
    })
  }
  return out
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test lib/snapshots.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire into the page**

In `app/page.tsx`, after building windows:

```tsx
const qualifyingHours = hours.filter((h) => judge(h).pass).length
await saveSnapshot(raw, windows.length, qualifyingHours)
const withStability = await attachStability(windows)
```

Destructure `raw` from `fetchForecast()`. Render `withStability` instead of `windows`, and add inside the `<li>`:

```tsx
{w.stability && (
  <span className="quiet">
    {' · '}
    {w.stability.forecastsSeen === 1 ? 'new in this forecast' : `seen in ${w.stability.forecastsSeen} forecasts`}
  </span>
)}
```

- [ ] **Step 7: Run the app twice and confirm stability appears**

```bash
npm run dev
```

Load the page, wait, then hard-reload after the 1800s revalidate window or restart the server. Expected: the second render shows "seen in 2 forecasts" on windows that persisted. **Confirm `dunmore.db` was created and is gitignored.**

- [ ] **Step 8: Commit**

```bash
git add lib/snapshots.ts lib/snapshots.test.ts app/page.tsx .gitignore .env.example
git commit -m "Add forecast snapshots and window stability tracking"
```

---

### Task 9: Wind map

**Files:**
- Create: `components/WindMap.tsx`
- Create: `lib/projection.ts`
- Modify: `app/page.tsx`, `app/dunmore.css`
- Test: `lib/projection.test.ts`

**Interfaces:**
- Consumes: `loadLakePolygon`, `fetchMeters` (Task 7), `HourlyConditions` (Task 2)
- Produces: `projectToSvg(poly: LatLon[], width: number, height: number): { path: string; project: (ll: LatLon) => [number, number] }`

- [ ] **Step 1: Write the failing projection test**

`lib/projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadLakePolygon } from './geometry'
import { projectToSvg } from './projection'

describe('projectToSvg', () => {
  const { path, project } = projectToSvg(loadLakePolygon(), 300, 500)

  it('produces a closed SVG path', () => {
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('keeps every projected point inside the viewport', () => {
    for (const ll of loadLakePolygon()) {
      const [x, y] = project(ll)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(300)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(500)
    }
  })

  it('puts north at the top, so higher latitude means smaller y', () => {
    const lats = loadLakePolygon().map((p) => p[1])
    const north = loadLakePolygon().find((p) => p[1] === Math.max(...lats))!
    const south = loadLakePolygon().find((p) => p[1] === Math.min(...lats))!
    expect(project(north)[1]).toBeLessThan(project(south)[1])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/projection.test.ts`
Expected: FAIL, cannot resolve `./projection`.

- [ ] **Step 3: Write `lib/projection.ts`**

```ts
import type { LatLon } from './geometry'

export function projectToSvg(poly: LatLon[], width: number, height: number) {
  const lons = poly.map((p) => p[0])
  const lats = poly.map((p) => p[1])
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const pad = 8
  const sx = (width - pad * 2) / (maxLon - minLon)
  const sy = (height - pad * 2) / (maxLat - minLat)
  const s = Math.min(sx, sy)
  const ox = pad + ((width - pad * 2) - (maxLon - minLon) * s) / 2
  const oy = pad + ((height - pad * 2) - (maxLat - minLat) * s) / 2

  const project = ([lon, lat]: LatLon): [number, number] => [
    ox + (lon - minLon) * s,
    oy + (maxLat - lat) * s, // north up
  ]

  const path =
    poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${project(p).map((n) => n.toFixed(1)).join(',')}`).join('') + 'Z'

  return { path, project }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test lib/projection.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `components/WindMap.tsx`**

```tsx
import { loadLakePolygon } from '@/lib/geometry'
import { projectToSvg } from '@/lib/projection'

const W = 260
const H = 460

export function WindMap({
  bearingDeg,
  windKt,
  cardinal,
  fetchMi,
}: {
  bearingDeg: number
  windKt: number
  cardinal: string
  fetchMi: number
}) {
  const { path } = projectToSvg(loadLakePolygon(), W, H)
  // NWS reports the direction wind comes FROM. Motion points the opposite way.
  const motion = bearingDeg + 180
  const arrows: [number, number][] = []
  for (let x = 20; x < W; x += 42) for (let y = 20; y < H; y += 42) arrows.push([x, y])

  return (
    <figure className="map">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
           aria-label={`Lake Dunmore, wind from the ${cardinal} at ${Math.round(windKt)} knots`}>
        <defs>
          <clipPath id="lake"><path d={path} /></clipPath>
        </defs>
        <path d={path} className="water" />
        <g clipPath="url(#lake)" className="arrows">
          {arrows.map(([x, y]) => (
            <g key={`${x}-${y}`} transform={`translate(${x},${y}) rotate(${motion})`}>
              <line x1="0" y1="7" x2="0" y2="-7" />
              <path d="M0,-9 L3,-4 L-3,-4 Z" />
            </g>
          ))}
        </g>
      </svg>
      <figcaption>
        Wind from the <strong>{cardinal}</strong> at {Math.round(windKt)} kt ·
        fetch {fetchMi.toFixed(1)} mi
        <br />
        <span className="quiet">
          One NWS reading covers the whole lake, so the arrows do not vary. The fetch line length is
          the real derived value. Lake outline: OpenStreetMap contributors, ODbL.
        </span>
      </figcaption>
    </figure>
  )
}
```

Add to `app/dunmore.css`:

```css
.map { margin: 1.5rem 0; }
.map svg { max-width: 100%; height: auto; }
.water { fill: color-mix(in srgb, #4a90d9 22%, transparent); stroke: #4a90d9; stroke-width: 1.2; }
.arrows line, .arrows path { stroke: #4a90d9; fill: #4a90d9; stroke-width: 1.4; opacity: 0.85; }
figcaption { font-size: 0.85rem; color: var(--quiet); margin-top: 0.5rem; }
```

- [ ] **Step 6: Render the map for the next window**

In `app/page.tsx`, import `WindMap` and `fetchMeters`, and render below the headline:

```tsx
{next && (
  <WindMap
    bearingDeg={nextDeg}
    windKt={(next.windKtMin + next.windKtMax) / 2}
    cardinal={next.directions[0]}
    fetchMi={next.fetchMetersMax / 1609}
  />
)}
```

Where `nextDeg` is the `windDirectionDeg` of the first hour inside the next window:

```tsx
const nextDeg = next
  ? hours.find((h) => h.startTime === next.start)?.windDirectionDeg ?? 0
  : 0
```

- [ ] **Step 7: Verify the arrow direction by hand**

Run `npm run dev` and check: with `windDirection` reported as `S` (wind **from** the south), arrows must point **up the page, toward the north**. If they point down, the `+ 180` was applied twice or not at all. This is the error the spec called out as invisible on inspection, so verify it deliberately rather than glancing at it.

- [ ] **Step 8: Commit**

```bash
git add components/ lib/projection.ts lib/projection.test.ts app/
git commit -m "Add wind map with lake outline, arrows, and fetch label"
```

---

## Deferred to phase 2, not in this plan

- Calendar overlay via private `.ics` feeds.
- Calibration log (observed conditions vs forecast).
- Push notifications.
- Hour scrubbing that redraws the map on hover. The spec calls for it; this plan renders the map for the next window only, so `WindMap` stays a server component and the page needs no client-side state. Adding the scrubber later means making `WindMap` a client component and lifting a selected-hour index into it. Nothing in this plan blocks that.
- Vercel deployment and the daily cron floor. Local only, per the current request.

## Verification before calling this done

- [ ] `npm test` passes with every file green.
- [ ] `npm run dev` serves a page with a real headline built from live NWS data.
- [ ] The hour grid has both passing and failing cells, and tooltips name real reasons.
- [ ] Arrows point the correct way for a known wind direction (Task 9, Step 7).
- [ ] `dunmore.db` exists, is gitignored, and `snapshots` has more than one row.
- [ ] `git status` is clean and `.env` is untracked.
