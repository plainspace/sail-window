export const CONFIG = {
  // Centroid of the lake polygon, verified inside the water by point-in-polygon.
  // The earlier value (43.885, -73.085) was on land southwest of the lake and
  // resolved to a different NWS grid cell.
  location: { lat: 43.90234, lon: -73.07574, tz: 'America/New_York' },
  wind: { minKt: 7, maxKt: 20, maxGustKt: 30 },
  precip: { maxProbability: 20 },
  window: { minHours: 3 },
  season: { start: { month: 5, day: 1 }, end: { month: 11, day: 1 } },
  nws: {
    gridpointUrl: 'https://api.weather.gov/gridpoints/BTV/97,31',
    userAgent: 'dunmore-sailing-app (jaredvolpe@gmail.com)',
  },
} as const
