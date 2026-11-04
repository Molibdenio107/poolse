import { fetchWeather, type Weather } from './open-meteo.js';

/**
 * The forecast, cached per place — backlog round 3, story 3; shared since
 * POOLSE-170, so the site's weather panel and the Painel's weather card read
 * the same entries and a club never costs two calls.
 *
 * In-process, and that is a deliberate limit rather than an oversight. It
 * resets on deploy and is not shared between instances, so N instances make up
 * to N times the requests. At the volumes above that is still nothing, and the
 * alternative — Redis, or a table — is infrastructure to run and back up for a
 * cache whose worst failure is one extra call to a free API. Revisit if the API
 * ever runs more than a couple of instances.
 */

/** 45 minutes. Open-Meteo updates hourly, so anything shorter buys staleness nobody sees. */
const TTL_MS = 45 * 60 * 1000;
/** Far more sites than any instance serves; a ceiling, not a working size. */
const MAX_CACHED = 500;

/**
 * Two decimal places — about 1.1 km.
 *
 * Coarser than the coordinates we store, deliberately: two clubs in the same
 * town should share one cache entry rather than each holding their own copy of
 * the same weather. It is the difference between caching per *place* and caching
 * per *customer*.
 */
function cacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

const cache = new Map<string, { at: number; weather: Weather }>();

/**
 * The weather at a point, from the cache or the provider. Null when the
 * provider could not be reached — and a failure is not cached, so the next
 * page load tries again rather than serving "unavailable" for 45 minutes.
 *
 * The cache is filled by the fetch itself, so a caller that gives up waiting
 * (the dashboard's 2 s ceiling) still leaves the answer for the next one.
 */
export async function weatherAt(latitude: number, longitude: number): Promise<Weather | null> {
  const key = cacheKey(latitude, longitude);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at <= TTL_MS) return entry.weather;
  if (entry) cache.delete(key);

  const weather = await fetchWeather(latitude, longitude);
  if (weather === null) return null;

  cache.set(key, { at: Date.now(), weather });
  // Bounded: a club has a handful of sites. Oldest first out — a Map iterates
  // in insertion order.
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return weather;
}
