import { describe, it, expect } from 'vitest'
import { buildCalendar, foldLine, escapeText, stampUtc } from './ics'
import { getSpot } from '@/config/spots'
import { windPhrase, type SailWindow } from './windows'

const spot = getSpot('dunmore')!
const NOW = new Date('2026-08-12T19:37:42.501Z')
const opts = { origin: 'https://example.test', now: NOW }

const win = (over: Partial<SailWindow> = {}): SailWindow => ({
  start: '2026-08-13T17:00:00.000Z',
  end: '2026-08-13T21:00:00.000Z',
  hours: 4,
  windKtMin: 8.2,
  windKtMax: 13.4,
  gustKtMax: 22,
  directions: ['SW'],
  temperatureFAvg: 74,
  hasUnknownGust: false,
  ...over,
})

const octets = (s: string) => new TextEncoder().encode(s).length

/** Reverse the 75-octet folding: a CRLF followed by one space is a continuation. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '')

/** All values for a property, from the unfolded feed. */
function values(ics: string, prop: string): string[] {
  return unfold(ics)
    .split('\r\n')
    .filter((l) => l === prop || l.startsWith(`${prop}:`) || l.startsWith(`${prop};`))
    .map((l) => l.slice(l.indexOf(':') + 1))
}

/**
 * The VEVENT blocks on their own. DESCRIPTION exists at both calendar and event level,
 * so any assertion about an event's body has to say which one it means.
 */
function events(ics: string): string[] {
  return unfold(ics)
    .split('BEGIN:VEVENT\r\n')
    .slice(1)
    .map((block) => block.slice(0, block.indexOf('END:VEVENT')))
}

describe('foldLine', () => {
  const cases = [
    '',
    'SHORT:value',
    'A'.repeat(200),
    // A two-octet character straddling the boundary: 74 ASCII then a degree sign,
    // which cannot fit in the one remaining octet and must move to the next line.
    `${'A'.repeat(74)}°${'B'.repeat(80)}`,
    `SUMMARY:⛵ ${'wind '.repeat(40)}`,
    '°'.repeat(90),
  ]

  it('never emits a line over 75 octets', () => {
    for (const c of cases) {
      for (const line of foldLine(c).split('\r\n')) {
        expect(octets(line)).toBeLessThanOrEqual(75)
      }
    }
  })

  it('round-trips: unfolding restores the original exactly', () => {
    for (const c of cases) {
      expect(foldLine(c).replace(/\r\n /g, '')).toBe(c)
    }
  })

  it('does not split a multi-byte character across the fold', () => {
    // Every folded line must survive an encode/decode cycle unchanged, which it only
    // does if no character was cut in half.
    const decoder = new TextDecoder('utf-8', { fatal: true })
    for (const c of cases) {
      for (const line of foldLine(c).split('\r\n')) {
        expect(() => decoder.decode(new TextEncoder().encode(line))).not.toThrow()
      }
    }
  })
})

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newline', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('escapes backslashes before the escapes it introduces', () => {
    // A naive ordering turns ';' into '\;' and then doubles that backslash.
    expect(escapeText(';')).toBe('\\;')
  })

  it('leaves a colon alone, which RFC 5545 does not escape in TEXT', () => {
    expect(escapeText('Sail: 8 to 13 kt')).toBe('Sail: 8 to 13 kt')
  })
})

describe('stampUtc', () => {
  it('emits the compact UTC form with no separators or milliseconds', () => {
    expect(stampUtc('2026-08-13T17:00:00.000Z')).toBe('20260813T170000Z')
  })
})

describe('buildCalendar', () => {
  it('emits one VEVENT per window', () => {
    const ics = buildCalendar([win(), win({ start: '2026-08-14T13:00:00.000Z' })], spot, opts)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2)
  })

  it('carries the window times through as UTC, needing no VTIMEZONE', () => {
    const ics = buildCalendar([win()], spot, opts)
    expect(values(ics, 'DTSTART')).toEqual(['20260813T170000Z'])
    expect(values(ics, 'DTEND')).toEqual(['20260813T210000Z'])
    expect(ics).not.toContain('VTIMEZONE')
  })

  it('marks events free rather than busy', () => {
    expect(values(buildCalendar([win()], spot, opts), 'TRANSP')).toEqual(['TRANSPARENT'])
  })

  it('rounds the wind into the summary the way the page does', () => {
    const ics = buildCalendar([win({ windKtMin: 8.2, windKtMax: 13.4 })], spot, opts)
    expect(values(ics, 'SUMMARY')[0]).toContain('8 to 13 kt')
  })

  describe('gusts', () => {
    it('names the gust in the summary when it exceeds the sustained maximum', () => {
      const ics = buildCalendar([win({ gustKtMax: 22 })], spot, opts)
      expect(values(ics, 'SUMMARY')[0]).toContain('gusting 22')
    })

    it('omits it when the gust does not exceed the sustained maximum', () => {
      const ics = buildCalendar([win({ gustKtMax: 11 })], spot, opts)
      expect(values(ics, 'SUMMARY')[0]).not.toContain('gusting')
    })

    it('puts the gust in the first line of the body, not under the gate list', () => {
      const body = values(events(buildCalendar([win({ gustKtMax: 22 })], spot, opts))[0], 'DESCRIPTION')[0]
      expect(body.split('\\n')[0]).toContain('gusting 22 kt')
    })

    it('phrases the event exactly as the page phrases the window', () => {
      // Both call windPhrase. If this ever diverges, a calendar event and the page are
      // describing one window two different ways, which is the bug this app most
      // needs to not have.
      const w = win({ gustKtMax: 22 })
      const ics = buildCalendar([w], spot, opts)
      // The property carries the ESCAPED form, so the comma in the phrase arrives as
      // '\,'. Comparing against the raw phrase would fail for the wrong reason.
      expect(values(ics, 'SUMMARY')[0]).toBe(escapeText(`⛵ Sail: ${windPhrase(w)}`))
    })
  })

  it('names the gates it cleared using the spot own thresholds', () => {
    const [body] = values(events(buildCalendar([win()], spot, opts))[0], 'DESCRIPTION')
    expect(body).toContain(`${spot.wind.minKt} to ${spot.wind.maxKt} kt`)
    expect(body).toContain(`gusts under ${spot.wind.maxGustKt} kt`)
    expect(body).toContain(`rain under ${spot.precip.maxProbability}%`)
  })

  it('flags a window whose gust data was incomplete', () => {
    const ics = buildCalendar([win({ hasUnknownGust: true })], spot, opts)
    expect(values(events(ics)[0], 'DESCRIPTION')[0]).toContain('missing gust data')
  })

  it('does not flag a window whose gust data was complete', () => {
    const ics = buildCalendar([win({ hasUnknownGust: false })], spot, opts)
    expect(values(events(ics)[0], 'DESCRIPTION')[0]).not.toContain('missing gust data')
  })

  it('describes the calendar itself as well as each event', () => {
    // Two DESCRIPTION properties at two levels, which is correct and easy to conflate.
    const ics = buildCalendar([win()], spot, opts)
    expect(values(ics, 'DESCRIPTION')[0]).toContain('Rebuilt on every refresh')
    expect(values(events(ics)[0], 'DESCRIPTION')[0]).toContain('Cleared all four gates')
  })

  it('links back to the spot page on the origin it was served from', () => {
    const ics = buildCalendar([win()], spot, opts)
    expect(values(ics, 'URL')).toEqual(['https://example.test/dunmore'])
  })

  describe('UID', () => {
    it('is derived from the spot and the window start', () => {
      const ics = buildCalendar([win()], spot, opts)
      expect(values(ics, 'UID')).toEqual([
        `dunmore-${Date.parse('2026-08-13T17:00:00.000Z')}@sail-window`,
      ])
    })

    it('is stable across rebuilds at a different clock time', () => {
      const a = values(buildCalendar([win()], spot, opts), 'UID')
      const b = values(buildCalendar([win()], spot, { ...opts, now: new Date('2026-08-12T21:04:00Z') }), 'UID')
      expect(a).toEqual(b)
    })

    it('differs when the model shifts the window, so it reads as a new window', () => {
      const a = values(buildCalendar([win()], spot, opts), 'UID')[0]
      const b = values(buildCalendar([win({ start: '2026-08-13T18:00:00.000Z' })], spot, opts), 'UID')[0]
      expect(a).not.toBe(b)
    })
  })

  describe('DTSTAMP', () => {
    it('is truncated to the hour', () => {
      expect(values(buildCalendar([win()], spot, opts), 'DTSTAMP')).toEqual(['20260812T190000Z'])
    })

    it('makes two polls within the same hour byte-identical', () => {
      const a = buildCalendar([win()], spot, { ...opts, now: new Date('2026-08-12T19:02:00Z') })
      const b = buildCalendar([win()], spot, { ...opts, now: new Date('2026-08-12T19:58:59Z') })
      expect(a).toBe(b)
    })
  })

  describe('an empty week', () => {
    // The off-season case reaches here too: judge() fails every off-season hour, so
    // buildWindows returns nothing and the feed is simply empty.
    const ics = buildCalendar([], spot, opts)

    it('is still a valid, parseable calendar', () => {
      expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
      expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
      expect(values(ics, 'VERSION')).toEqual(['2.0'])
    })

    it('carries no events', () => {
      expect(ics).not.toContain('BEGIN:VEVENT')
    })

    it('still names itself, so a subscriber sees an empty calendar and not a broken one', () => {
      expect(values(ics, 'X-WR-CALNAME')).toEqual(['Sailing: Lake Dunmore'])
    })
  })

  describe('line discipline', () => {
    const ics = buildCalendar([win({ hasUnknownGust: true }), win({ start: '2026-08-14T13:00:00.000Z' })], spot, opts)

    it('uses CRLF throughout and ends with one', () => {
      expect(ics.endsWith('\r\n')).toBe(true)
      expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
    })

    it('holds every line to 75 octets', () => {
      for (const line of ics.split('\r\n')) {
        expect(octets(line)).toBeLessThanOrEqual(75)
      }
    })

    it('folds the long description rather than truncating it', () => {
      expect(ics).toMatch(/\r\n /)
      expect(values(events(ics)[0], 'DESCRIPTION')[0]).toContain('Cleared all four gates')
    })
  })
})
