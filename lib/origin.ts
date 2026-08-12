/**
 * The public origin this request arrived on, e.g. 'https://sail-window.vercel.app'.
 *
 * Derived from headers rather than from `request.url`, because behind Vercel's proxy
 * the internal URL does not always carry the hostname a visitor actually typed, and a
 * calendar feed that emits links to the wrong host is broken in a way that only shows
 * up in production.
 */
export function originFrom(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000'
  const local = /^(localhost|127\.|\[::1\])/.test(host)
  const proto = headers.get('x-forwarded-proto') ?? (local ? 'http' : 'https')
  return `${proto}://${host}`
}
