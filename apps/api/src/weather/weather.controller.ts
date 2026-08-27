import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { fetchWeather, searchPlaces, type Place, type Weather } from './open-meteo.js';

/**
 * Weather and city lookup — backlog round 3, story 3.
 *
 * Both go through the API rather than the browser, for the reason in
 * `open-meteo.ts`: from here the request volume is a function of how many
 * distinct cities our customers are in and how often the cache expires, and from
 * the browser it is a function of page views and keystrokes.
 *
 * Tenant-scoped like everything else, which is not about the data — a forecast
 * for Aveiro is not anybody's secret — but about who may spend our quota. An
 * unauthenticated proxy to somebody else's rate-limited API is a gift to whoever
 * finds it first.
 */

/** 45 minutes. Open-Meteo updates hourly, so anything shorter buys staleness nobody sees. */
const TTL_MS = 45 * 60 * 1000;

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

interface Entry {
  at: number;
  weather: Weather;
}

/**
 * In-process, and that is a deliberate limit rather than an oversight.
 *
 * It resets on deploy and is not shared between instances, so N instances make
 * up to N times the requests. At the volumes above that is still nothing, and
 * the alternative — Redis, or a table — is infrastructure to run and back up for
 * a cache whose worst failure is one extra call to a free API. Revisit if the
 * API ever runs more than a couple of instances.
 */
const cache = new Map<string, Entry>();

function cached(latitude: number, longitude: number): Weather | null {
  const entry = cache.get(cacheKey(latitude, longitude));
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(cacheKey(latitude, longitude));
    return null;
  }
  return entry.weather;
}

interface WeatherResponse {
  /** False when Open-Meteo could not be reached. The panel says so; the page renders. */
  available: boolean;
  weather: Weather | null;
}

@Controller('weather')
export class WeatherController {
  @Get()
  async current(
    @Query('latitude') latitudeRaw: string,
    @Query('longitude') longitudeRaw: string,
  ): Promise<WeatherResponse> {
    const latitude = degrees(latitudeRaw, 'latitude', 90);
    const longitude = degrees(longitudeRaw, 'longitude', 180);

    const hit = cached(latitude, longitude);
    if (hit) return { available: true, weather: hit };

    const weather = await fetchWeather(latitude, longitude);
    // A failure is not cached. The next page load should try again rather than
    // serve "unavailable" for the next 45 minutes because of one bad moment.
    if (weather === null) return { available: false, weather: null };

    cache.set(cacheKey(latitude, longitude), { at: Date.now(), weather });
    return { available: true, weather };
  }
}

@Controller('places')
export class PlacesController {
  /**
   * City autocomplete. Debounced in the browser; not cached here.
   *
   * Caching would be caching prefixes — "Av", "Ave", "Aveir" — which is a large
   * number of keys each used approximately once. The debounce is what keeps this
   * cheap, and it belongs on the keystroke, not on the result.
   */
  @Get()
  async search(
    @Query('q') query: string,
    @Query('language') language = 'pt',
  ): Promise<{ places: Place[] }> {
    const term = (query ?? '').trim();
    // Below two characters every town in Europe matches and the answer is noise.
    if (term.length < 2) return { places: [] };

    return { places: await searchPlaces(term, language) };
  }
}

function degrees(value: string, field: string, limit: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < -limit || parsed > limit) {
    throw new BadRequestException(`${field} must be between -${limit} and ${limit} degrees`);
  }
  return parsed;
}
