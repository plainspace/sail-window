// Every place this app can answer for. To add your own spot, copy the Dunmore
// entry, change the slug, name, coordinates, and thresholds, and set NWS_CONTACT
// in your environment. The outline is optional (see the `outline` field).
//
// Coverage is the United States only: forecasts come from the US National Weather
// Service, which does not cover other countries.

export type Spot = {
  slug: string // url segment, e.g. 'dunmore'
  name: string // 'Lake Dunmore'
  region: string // 'Vermont'
  lat: number
  lon: number
  tz: string // IANA, e.g. 'America/New_York'
  wind: { minKt: number; maxKt: number; maxGustKt: number }
  precip: { maxProbability: number }
  window: { minHours: number }
  season: { start: { month: number; day: number }; end: { month: number; day: number } }
  outline?: string // optional path under data/, e.g. 'lake-dunmore.json'
}

export const SPOTS: Spot[] = [
  {
    slug: 'dunmore',
    name: 'Lake Dunmore',
    region: 'Vermont',
    // Centroid of the lake polygon, verified inside the water by point-in-polygon.
    // An earlier value (43.885, -73.085) was on land southwest of the lake and
    // resolved to a different NWS grid cell.
    lat: 43.90234,
    lon: -73.07574,
    tz: 'America/New_York',
    wind: { minKt: 7, maxKt: 20, maxGustKt: 30 },
    precip: { maxProbability: 30 },
    window: { minHours: 3 },
    season: { start: { month: 5, day: 1 }, end: { month: 11, day: 1 } },
    outline: 'lake-dunmore.json',
  },
]

export const getSpot = (slug: string): Spot | undefined =>
  SPOTS.find((s) => s.slug === slug)
