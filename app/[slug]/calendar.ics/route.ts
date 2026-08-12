import { fetchForecast } from '@/lib/openmeteo'
import { buildWindows } from '@/lib/windows'
import { buildCalendar } from '@/lib/ics'
import { originFrom } from '@/lib/origin'
import { SPOTS, getSpot } from '@/config/spots'

// Same posture as the page: rebuild on every request so a subscriber is never served
// a stale forecast. The upstream Open-Meteo call is still cached for 15 minutes in
// lib/openmeteo.ts, so a polling calendar cannot hammer them.
export const dynamic = 'force-dynamic'

export function generateStaticParams() {
  return SPOTS.map((s) => ({ slug: s.slug }))
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const spot = getSpot(slug)
  if (!spot) return new Response('No such spot.\n', { status: 404 })

  // Out of season this is empty, and correctly so: judge() fails every off-season
  // hour, so buildWindows returns nothing and the feed carries no events. The page
  // still shows the forecast for reference, but an event on a calendar *is* the
  // recommendation, and there is nothing to recommend.
  const { hours } = await fetchForecast(spot)
  const windows = buildWindows(hours, spot)

  const body = buildCalendar(windows, spot, {
    origin: originFrom(request.headers),
    now: new Date(),
  })

  // ?download=1 forces a file rather than letting the browser decide. Subscribing is
  // the better mode and stays the default, but it depends on the OS having `webcal:`
  // registered to a calendar, and browsers quietly claim that handler... at which point
  // the button opens a browser tab and the feature looks broken. A download needs no
  // scheme, no handler and no client configuration, so it is the escape hatch.
  const wantsDownload = new URL(request.url).searchParams.has('download')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `${wantsDownload ? 'attachment' : 'inline'}; filename="${spot.slug}-sailing.ics"`,
      // Let a CDN absorb repeated polls for 15 minutes, matching the upstream cache,
      // while never letting a client hold onto it.
      'Cache-Control': 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
    },
  })
}
