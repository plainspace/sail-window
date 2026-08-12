// Emits the sailable windows as an iCalendar feed (RFC 5545) meant to be *subscribed*
// to, not downloaded. A downloaded file is stale within the hour; a subscription is
// re-fetched, and because each fetch replaces the whole feed, a window the model
// withdraws simply disappears. That is the entire reason there is no delete logic
// anywhere in this file.
//
// Pure: no fetching, no clock reads beyond the `now` handed in. Everything it needs
// comes from the SailWindow[] the page already builds.

import type { SailWindow } from './windows'
import type { Spot } from '@/config/spots'

export type CalendarOptions = {
  /** Absolute origin for links, e.g. 'https://sail-window.vercel.app'. No trailing slash. */
  origin: string
  /** Injected rather than read, so a build is reproducible in tests. */
  now: Date
}

const encoder = new TextEncoder()

/**
 * Fold to the 75-octet line limit, continuation lines prefixed with one space.
 *
 * Octets, not characters: the limit is defined in bytes, and this feed carries a
 * degree sign and an emoji. Iterating by code point rather than by UTF-16 unit keeps
 * a multi-byte character from being split across the fold, which is the failure that
 * shows up as a mojibake title in one client and looks fine in every other.
 */
export function foldLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let octets = 0
  // A continuation line spends one of its 75 octets on the leading space.
  let limit = 75
  for (const char of line) {
    const size = encoder.encode(char).length
    if (octets + size > limit) {
      parts.push(current)
      current = ''
      octets = 0
      limit = 74
    }
    current += char
    octets += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/**
 * Escape a TEXT value. Order matters: backslashes first, or the escapes introduced by
 * the later replacements get escaped a second time.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** UTC form: 20260813T170000Z. Windows already carry UTC ISO strings, so no zone
 *  conversion happens here and the feed needs no VTIMEZONE block at all. */
export function stampUtc(when: string | Date): string {
  const iso = (when instanceof Date ? when : new Date(when)).toISOString()
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

const round = (n: number) => Math.round(n)

/** 'Sail: 8 to 13 kt SW' ... phrased exactly like the card on the page. */
function summaryFor(w: SailWindow): string {
  return `⛵ Sail: ${round(w.windKtMin)} to ${round(w.windKtMax)} kt ${w.directions.join('/')}`
}

/**
 * The body restates the thresholds it cleared, using the spot's own numbers. A window
 * read a week later, in a calendar, with no page around it, should still be able to
 * say what it means.
 */
function descriptionFor(w: SailWindow, spot: Spot, origin: string): string {
  const hours = w.hours === 1 ? '1 hour' : `${w.hours} hours`
  const lines = [
    `${hours}, ${w.temperatureFAvg}°F.`,
    '',
    `Cleared all four gates: daylight, ${spot.wind.minKt} to ${spot.wind.maxKt} kt ` +
      `sustained, gusts under ${spot.wind.maxGustKt} kt, rain under ` +
      `${spot.precip.maxProbability}%.`,
  ]
  if (w.hasUnknownGust) {
    lines.push(
      '',
      'The forecast is missing gust data for part of this window, so the gust ceiling ' +
        'went unchecked there.',
    )
  }
  lines.push('', `${origin}/${spot.slug}`)
  return lines.join('\n')
}

function event(w: SailWindow, spot: Spot, opts: CalendarOptions, dtstamp: string): string[] {
  return [
    'BEGIN:VEVENT',
    // Spot plus the window's own start. A window the model shifts by an hour is a
    // different window and correctly becomes a different event; a window it withdraws
    // vanishes with the feed it was in.
    `UID:${spot.slug}-${Date.parse(w.start)}@sail-window`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${stampUtc(w.start)}`,
    `DTEND:${stampUtc(w.end)}`,
    `SUMMARY:${escapeText(summaryFor(w))}`,
    `DESCRIPTION:${escapeText(descriptionFor(w, spot, opts.origin))}`,
    `LOCATION:${escapeText(`${spot.name}, ${spot.region}`)}`,
    `GEO:${spot.lat};${spot.lon}`,
    `URL:${opts.origin}/${spot.slug}`,
    // Free, not busy. A forecast is not a commitment, and anyone checking this
    // calendar for availability should not see a lake blocking a Wednesday.
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ]
}

export function buildCalendar(
  windows: SailWindow[],
  spot: Spot,
  opts: CalendarOptions,
): string {
  // Truncated to the hour, and shared by every event. DTSTAMP is the only field that
  // would otherwise change on every poll, and a feed that is byte-identical between
  // polls is one that cannot provoke a client into re-notifying about a window it
  // already knows. It also matches the REFRESH-INTERVAL advertised below.
  const hourly = new Date(opts.now)
  hourly.setUTCMinutes(0, 0, 0)
  const dtstamp = stampUtc(hourly)

  const name = `Sailing: ${spot.name}`
  const description =
    `Stretches of ${spot.window.minHours}+ hours when conditions allow sailing at ` +
    `${spot.name}, from the Open-Meteo forecast. Rebuilt on every refresh; windows ` +
    `appear and disappear as the forecast changes.`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sail-window//sail-window//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // NAME and DESCRIPTION are the RFC 7986 properties; the X-WR-* pair is what Apple
    // and Google actually read. Both are emitted because coverage differs by client.
    `NAME:${escapeText(name)}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `X-WR-CALDESC:${escapeText(description)}`,
    `X-WR-TIMEZONE:${spot.tz}`,
    // A hint, not a guarantee: Apple Calendar honours it as a default and lets you
    // override it per subscription, Google ignores it and polls on its own schedule.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...windows.flatMap((w) => event(w, spot, opts, dtstamp)),
    'END:VCALENDAR',
  ]

  // CRLF throughout, and a trailing one, as the spec requires.
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
