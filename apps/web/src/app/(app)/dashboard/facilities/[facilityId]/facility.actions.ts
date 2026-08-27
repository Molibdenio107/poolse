'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, apiPatch, type PlaceSuggestion } from '../../../../../lib/api';

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
