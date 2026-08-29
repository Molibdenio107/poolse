'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MapPin } from 'lucide-react';
import type { PlaceSuggestion } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { searchPlacesAction, setPlaceAction } from './facility.actions';
import { DEBOUNCE_MS, MIN_SEARCH_LENGTH } from '@/components/search-input';

/**
 * The city autocomplete — backlog round 3, story 3.
 *
 * It resolves a *place*, not a string. Picking from the list stores the city, the
 * country and the coordinates the geocoder returned, all in one write, and that
 * is the whole point: geocoding on every page render would be slow, would spend
 * quota on a question already answered, and would break this screen every time
 * somebody else's geocoder had a bad afternoon.
 *
 * Only the city is a lookup. Street, number and postcode stay ordinary text —
 * they are typed once per club and no autocomplete is worth the trouble.
 */
export function CityPicker({
  organizationId,
  facilityId,
  city,
  countryCode,
}: {
  organizationId: string;
  facilityId: string;
  city: string | null;
  countryCode: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, startSaving] = useTransition();

  // Guards against an out-of-order response overwriting a newer one: type
  // "Aveiro" quickly and the answer for "Ave" can land after the answer for
  // "Aveiro", putting stale suggestions under a finished word.
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const ticket = ++latest.current;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await searchPlacesAction(term, locale);
          if (ticket !== latest.current) return;
          setSuggestions(found);
          setFailed(false);
        } catch {
          if (ticket !== latest.current) return;
          // The geocoder being down must not stop somebody filling in the rest
          // of the form. They lose the suggestions, not the screen.
          setSuggestions([]);
          setFailed(true);
        } finally {
          if (ticket === latest.current) setSearching(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, locale]);

  function choose(place: PlaceSuggestion): void {
    startSaving(async () => {
      await setPlaceAction({
        organizationId,
        facilityId,
        city: place.city,
        countryCode: place.countryCode,
        latitude: place.latitude,
        longitude: place.longitude,
      });
      setQuery('');
      setSuggestions([]);
    });
  }

  function clear(): void {
    startSaving(async () => {
      await setPlaceAction({
        organizationId,
        facilityId,
        city: null,
        countryCode: null,
        latitude: null,
        longitude: null,
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={FIELD_COLUMN}>
        <label htmlFor={`${listId}-input`} className={FIELD_LABEL}>
          {t('facilities.city')}
        </label>

        {city !== null && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <MapPin className="size-4 text-primary" aria-hidden />
              {city}
              {countryCode !== null && (
                <span className="text-foreground-muted">({countryCode})</span>
              )}
            </span>
            <button
              type="button"
              onClick={clear}
              disabled={saving}
              className="rounded text-sm text-foreground-muted hover:text-danger disabled:opacity-60"
            >
              {t('facilities.clearCity')}
            </button>
          </div>
        )}

        <input
          id={`${listId}-input`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('facilities.cityPlaceholder')}
          autoComplete="off"
          aria-describedby={`${listId}-hint`}
          className={CONTROL_LINE}
        />
        <p id={`${listId}-hint`} className="text-sm text-foreground-muted">
          {t('facilities.cityHint')}
        </p>
      </div>

      {searching && <p className="text-sm text-foreground-muted">{t('common.working')}</p>}

      {failed && <p className="text-sm text-warning">{t('facilities.cityLookupFailed')}</p>}

      {suggestions.length > 0 && (
        // A list of buttons rather than a `datalist`: the browser's own
        // autocomplete can only offer strings, and what has to come back here is
        // a place with coordinates attached. It also lets each row show the
        // region, which is the only way to tell six Aveiros apart.
        <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {suggestions.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => choose(place)}
                disabled={saving}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-surface-muted disabled:opacity-60"
              >
                <span className="font-medium">{place.city}</span>
                <span className="text-sm text-foreground-muted">
                  {[place.region, place.country].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
