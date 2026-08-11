// Genuinely global settings, shared by every spot. Per-location values (coordinates,
// wind band, season, outline) live in config/spots.ts instead.

/**
 * The contact the NWS requires in every request's User-Agent. NWS rejects calls
 * without one, so this throws rather than sending an anonymous request. Read from
 * the environment so no personal address is baked into source. See .env.example.
 */
export function nwsContact(): string {
  const contact = process.env.NWS_CONTACT
  if (!contact) {
    throw new Error(
      'NWS_CONTACT is not set. The US National Weather Service requires a contact ' +
        '(an email address or URL) in the User-Agent of every request and rejects ' +
        'calls that omit it. Set NWS_CONTACT in your environment, for example ' +
        'NWS_CONTACT=you@example.com. See .env.example.',
    )
  }
  return contact
}

/** The User-Agent sent to NWS: a stable app identifier plus the required contact. */
export function nwsUserAgent(): string {
  return `sail-window-app (${nwsContact()})`
}
