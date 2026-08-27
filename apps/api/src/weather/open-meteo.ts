import { Logger } from '@nestjs/common';

/**
 * Open-Meteo, behind two functions — backlog round 3, story 3.
 *
 * **Called from here, never from the browser.** The story is right about why and
 * it is the whole design: from the server, request volume scales with the number
 * of distinct client cities times the refresh interval — fifty clubs on a
 * 45-minute cache is roughly 1,200 calls a day. From the browser it scales with
 * page views, which exhausts any tier and puts our usage pattern in front of
 * every visitor.
 *
 * **Licensing.** Open-Meteo's free tier is non-commercial use only. That is fine
 * while Poolse has no paying customers and is not fine the day it does. Both the
 * base URLs and an optional key are environment variables from this first
 * commit, so moving to the commercial endpoint is a config change rather than a
 * refactor — which is precisely why they are read here and nowhere else.
 *
 * **Nothing in this file throws.** Weather is decoration on an operational
 * screen; a pool does not stop running because a forecast API is down. Every
 * entry point returns a null-ish result and logs, and the panel says so.
 */

const logger = new Logger('OpenMeteo');

/** Ten seconds. A forecast that has not arrived by then is not worth the page waiting. */
const TIMEOUT_MS = 10_000;

function forecastUrl(): string {
  return process.env['OPEN_METEO_FORECAST_URL'] ?? 'https://api.open-meteo.com/v1/forecast';
}

function geocodingUrl(): string {
  return (
    process.env['OPEN_METEO_GEOCODING_URL'] ?? 'https://geocoding-api.open-meteo.com/v1/search'
  );
}

/** Empty on the free tier. The commercial endpoints take it as `apikey`. */
function apiKey(): string | null {
  return process.env['OPEN_METEO_API_KEY'] || null;
}

async function getJson(url: URL): Promise<unknown | null> {
  const key = apiKey();
  if (key) url.searchParams.set('apikey', key);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      logger.warn(`${url.pathname} answered ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    // Timeout, DNS, TLS, a malformed body — all the same answer to the caller.
    logger.warn(`${url.pathname} unreachable: ${String(error)}`);
    return null;
  }
}

export interface Place {
  /** Open-Meteo's own id, so the client has a stable key for its list. */
  id: number;
  city: string;
  countryCode: string | null;
  country: string | null;
  /** "Distrito de Aveiro" — what tells two places with the same name apart. */
  region: string | null;
  latitude: number;
  longitude: number;
}

interface RawPlace {
  id?: unknown;
  name?: unknown;
  country?: unknown;
  country_code?: unknown;
  admin1?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Cities matching what somebody is typing.
 *
 * `language` follows the reader, so a Portuguese operator sees "Londres" rather
 * than "London" and does not have to guess which of the two the system wants.
 */
export async function searchPlaces(query: string, language: string): Promise<Place[]> {
  const url = new URL(geocodingUrl());
  url.searchParams.set('name', query);
  url.searchParams.set('count', '8');
  // The geocoder takes a bare language tag, not a locale — "pt", not "pt-PT".
  url.searchParams.set('language', language.slice(0, 2).toLowerCase());
  url.searchParams.set('format', 'json');

  const body = await getJson(url);
  if (body === null || typeof body !== 'object') return [];

  const results = (body as { results?: unknown }).results;
  // No match is an empty list, not an error: it is what typing "Aveir" gets you
  // halfway through the word.
  if (!Array.isArray(results)) return [];

  return results.flatMap((entry): Place[] => {
    const raw = entry as RawPlace;
    const city = str(raw.name);
    const latitude = typeof raw.latitude === 'number' ? raw.latitude : null;
    const longitude = typeof raw.longitude === 'number' ? raw.longitude : null;
    if (city === null || latitude === null || longitude === null) return [];

    return [
      {
        id: typeof raw.id === 'number' ? raw.id : latitude * 1e6 + longitude,
        city,
        countryCode: str(raw.country_code)?.toUpperCase() ?? null,
        country: str(raw.country),
        region: str(raw.admin1),
        latitude,
        longitude,
      },
    ];
  });
}

export interface Weather {
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  windSpeedKmh: number | null;
  precipitationMm: number | null;
  /** WMO code. Translated in the web app, which owns every user-facing string. */
  weatherCode: number | null;
  isDay: boolean | null;
  days: ForecastDay[];
}

export interface ForecastDay {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  minC: number | null;
  maxC: number | null;
  weatherCode: number | null;
  precipitationMm: number | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Current conditions and the next few days, for one point.
 *
 * `timezone=auto` matters more than it looks: without it Open-Meteo returns days
 * bucketed in UTC, so an evening reading lands on tomorrow's row for anywhere
 * east of Greenwich and the forecast is quietly one day out.
 */
export async function fetchWeather(latitude: number, longitude: number): Promise<Weather | null> {
  const url = new URL(forecastUrl());
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,precipitation,weather_code,is_day,wind_speed_10m',
  );
  url.searchParams.set(
    'daily',
    'temperature_2m_min,temperature_2m_max,weather_code,precipitation_sum',
  );
  url.searchParams.set('forecast_days', '4');
  url.searchParams.set('timezone', 'auto');

  const body = await getJson(url);
  if (body === null || typeof body !== 'object') return null;

  const current = (body as { current?: Record<string, unknown> }).current ?? {};
  const daily = (body as { daily?: Record<string, unknown> }).daily ?? {};

  const dates = Array.isArray(daily['time']) ? (daily['time'] as unknown[]) : [];
  const mins = Array.isArray(daily['temperature_2m_min']) ? daily['temperature_2m_min'] : [];
  const maxes = Array.isArray(daily['temperature_2m_max']) ? daily['temperature_2m_max'] : [];
  const codes = Array.isArray(daily['weather_code']) ? daily['weather_code'] : [];
  const rain = Array.isArray(daily['precipitation_sum']) ? daily['precipitation_sum'] : [];

  const days: ForecastDay[] = dates.flatMap((value, index): ForecastDay[] => {
    const date = str(value);
    if (date === null) return [];
    return [
      {
        date,
        minC: num((mins as unknown[])[index]),
        maxC: num((maxes as unknown[])[index]),
        weatherCode: num((codes as unknown[])[index]),
        precipitationMm: num((rain as unknown[])[index]),
      },
    ];
  });

  return {
    temperatureC: num(current['temperature_2m']),
    apparentTemperatureC: num(current['apparent_temperature']),
    windSpeedKmh: num(current['wind_speed_10m']),
    precipitationMm: num(current['precipitation']),
    weatherCode: num(current['weather_code']),
    isDay: current['is_day'] === undefined ? null : current['is_day'] === 1,
    days,
  };
}
