import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type WeatherResponse } from '@/lib/api';
import { shortDate } from '@/lib/dates';

/**
 * Current conditions and a short forecast — backlog round 3, story 3.
 *
 * **Weather never breaks this page.** It is decoration on an operational screen:
 * an operator opening a site to check how many instructors they have does not
 * care that somebody's forecast API is having a bad afternoon, and must not be
 * shown an error page because of it. Every failure path here ends in a sentence
 * saying the data is unavailable, and the rest of the screen renders regardless.
 *
 * Rendered server-side, from a cache the API holds. A `fetch` from the browser
 * would scale with page views rather than with the number of distinct cities our
 * customers are in.
 */

/**
 * WMO weather codes, grouped.
 *
 * The full table is 28 codes distinguishing "light drizzle" from "moderate
 * drizzle", which is more precision than anybody deciding whether to move a
 * class indoors can use. These nine buckets are what an operator actually acts
 * on, and each one is a translated string like everything else in the product.
 */
function weatherKey(code: number | null): string {
  if (code === null) return 'weather.unknown';
  if (code === 0) return 'weather.clear';
  if (code <= 2) return 'weather.partlyCloudy';
  if (code === 3) return 'weather.overcast';
  if (code <= 48) return 'weather.fog';
  if (code <= 57) return 'weather.drizzle';
  if (code <= 67) return 'weather.rain';
  if (code <= 77) return 'weather.snow';
  if (code <= 82) return 'weather.showers';
  if (code <= 86) return 'weather.snowShowers';
  return 'weather.thunderstorm';
}

function degrees(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}°`;
}

export async function WeatherPanel({
  city,
  latitude,
  longitude,
}: {
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  // No city set is not an error and does not look like one. It is an invitation,
  // and the control that fixes it is on the same screen.
  if (city === null || latitude === null || longitude === null) {
    return (
      <section className="rounded border border-border bg-surface p-5">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('weather.title')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('weather.noCity')}</p>
      </section>
    );
  }

  let result: WeatherResponse | null = null;
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
    });
    result = await apiFetch<WeatherResponse>(`/weather?${params.toString()}`);
  } catch (error) {
    // Swallowed on purpose, and this is the line that makes the rule above true.
    // An ApiError here means our own API could not answer; anything else means
    // the fetch itself failed. Neither is worth taking the page down for.
    if (!(error instanceof ApiError) && !(error instanceof Error)) throw error;
  }

  const weather = result?.available === true ? result.weather : null;

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('weather.title')}
        </h2>
        {/*
          The city is named beside the reading, always. A temperature with no
          place on it is the kind of number somebody reads as their pool's water
          and acts on — and this is the air over a town.
        */}
        <p className="text-sm text-foreground-muted">{t('weather.forCity', { city })}</p>
      </div>

      {weather === null ? (
        <p className="text-sm text-foreground-muted">{t('weather.unavailable')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-3xl font-semibold">{degrees(weather.temperatureC)}</span>
            <span className="text-foreground-muted">{t(weatherKey(weather.weatherCode))}</span>
            {weather.apparentTemperatureC !== null && (
              <span className="text-sm text-foreground-muted">
                {t('weather.feelsLike', { value: degrees(weather.apparentTemperatureC) })}
              </span>
            )}
            {weather.windSpeedKmh !== null && (
              <span className="text-sm text-foreground-muted">
                {t('weather.wind', { value: Math.round(weather.windSpeedKmh) })}
              </span>
            )}
          </div>

          {weather.days.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-4">
              {weather.days.map((day) => (
                <li
                  key={day.date}
                  className="flex flex-col gap-0.5 rounded border border-border p-3"
                >
                  <span className="text-sm font-medium">{shortDate(day.date, locale)}</span>
                  <span className="text-sm text-foreground-muted">
                    {t(weatherKey(day.weatherCode))}
                  </span>
                  <span className="text-sm">
                    {degrees(day.minC)} / {degrees(day.maxC)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
