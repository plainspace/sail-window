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
