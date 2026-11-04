import { requireRole } from '../tenant/roles.js';
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { searchPlaces, type Place, type Weather } from './open-meteo.js';
import { weatherAt } from './forecast-cache.js';
import { CoreRoute } from '../tenant/modules.js';

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

interface WeatherResponse {
  /** False when Open-Meteo could not be reached. The panel says so; the page renders. */
  available: boolean;
  weather: Weather | null;
}

@CoreRoute()
@Controller('weather')
export class WeatherController {
  @Get()
  async current(
    @Query('latitude') latitudeRaw: string,
    @Query('longitude') longitudeRaw: string,
  ): Promise<WeatherResponse> {
    // The staff who see a site's weather panel — 13-10-2026 sweep: this was
    // the one handler with no role check, open to any member with any
    // coordinates, each new pair a paid-tier call and a cache entry.
    requireRole('owner', 'admin', 'instructor', 'maintenance');
    const latitude = degrees(latitudeRaw, 'latitude', 90);
    const longitude = degrees(longitudeRaw, 'longitude', 180);

    // The shared, per-place cache (`forecast-cache.ts`) — the Painel's card reads it too.
    const weather = await weatherAt(latitude, longitude);
    return weather === null ? { available: false, weather: null } : { available: true, weather };
  }
}

@CoreRoute()
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
    // Only the site's address editor needs it, and it drives an external API.
    requireRole('owner', 'admin');
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
