'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPatch, apiPut, type PlaceSuggestion } from '../../../../../lib/api';

/**
 * City lookup, proxied through the server.
 *
 * The browser never talks to Open-Meteo directly — see `open-meteo.ts` in the
 * API for why. This is the hop that keeps it that way while still feeling like
 * an autocomplete: the keystroke is debounced in the component, this runs on the
 * server with the session token, and the API holds the base URL and the optional
 * key.
 *
 * It throws on failure rather than returning an empty list, so the component can
 * tell "no such town" from "the geocoder is down" and say the right thing.
 */
export async function searchPlacesAction(
  query: string,
  locale: string,
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, language: locale.slice(0, 2) });
  const { places } = await apiFetch<{ places: PlaceSuggestion[] }>(`/places?${params.toString()}`);
  return places;
}

export interface PlaceInput {
  organizationId: string;
  facilityId: string;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Stores the place, all four fields together.
 *
 * Together is not a convenience — the database refuses half a coordinate, and a
 * city name with somebody else's coordinates under it would put the wrong town's
 * weather on the screen under the right town's name, which is worse than no
 * weather at all.
 */
export async function setPlaceAction(input: PlaceInput): Promise<void> {
  const { organizationId, facilityId, ...place } = input;

  await apiPatch(`/facilities/${facilityId}`, place, { organizationId });

  revalidatePath(`/dashboard/facilities/${facilityId}`);
  revalidatePath('/dashboard/facilities');
}

export interface HoursInput {
  organizationId: string;
  facilityId: string;
  days: { weekday: number; available: boolean; opensAt: string; closesAt: string }[];
}

/**
 * Saves the site's opening rules, as a week.
 *
 * The whole week per request, deliberately — see the API's `PUT
 * :facilityId/hours`. The revalidations are the two places these rules are read
 * from: the site itself, and the calendar, whose empty Sundays are only
 * explicable once this has changed.
 *
 * Returns a message key rather than throwing on a rejected week. A closing time
 * typed before an opening time is somebody making an ordinary mistake in a form,
 * and an error boundary is the wrong place to tell them about it.
 */
export async function saveHoursAction(
  input: HoursInput,
): Promise<{ ok: true } | { ok: false; errorKey: string }> {
  const { organizationId, facilityId, days } = input;

  try {
    await apiPut(`/facilities/${facilityId}/hours`, { days }, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, errorKey: 'facilities.hoursInvalid' };
    }
    return { ok: false, errorKey: 'facilities.hoursSaveFailed' };
  }

  revalidatePath(`/dashboard/facilities/${facilityId}`);
  revalidatePath('/dashboard/calendar');

  return { ok: true };
}
