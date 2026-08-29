'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MapPin, X } from 'lucide-react';
import type { PlaceSuggestion } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { searchPlacesAction } from './[facilityId]/facility.actions';

const DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

/**
 * Where the site is, chosen when it is created — round 5.
 *
 * **Why this is not `CityPicker`.** That one saves the moment you choose, which
 * is right on a facility that already exists and impossible on one that does
 * not: there is no `facilityId` to save against yet. This is the same search
 * against the same endpoint, but it writes into hidden fields and travels with
 * the create form. Two components rather than one with a mode flag, because the
 * difference between them is not a flag — one performs an action and one fills
 * in a form, and merging those produces a component with two lifecycles.
 *
 * **It replaces the optional address box on the create form.** An address is a
 * string somebody types for an invoice; it cannot tell the weather panel where
 * the pool is, and a facility created with only an address has no coordinates
 * until somebody remembers to come back and set them. Choosing a town at
 * creation means the weather works from the first page load. The free-text
 * address is still there on the detail page, where it is edited for invoicing.
 *
 * **A failed geocoder does not block the form.** If the lookup is down the
 * suggestions stop and everything else still saves — a site with no coordinates
 * is an ordinary state, and one nobody can create is not.
 */
export function PlaceField(): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();

  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<PlaceSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  // Same guard as CityPicker: "Ave" can answer after "Aveiro" and would put
  // stale suggestions under a finished word.
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_SEARCH_LENGTH || chosen !== null) {
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
          setSuggestions([]);
          setFailed(true);
        } finally {
          if (ticket === latest.current) setSearching(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, locale, chosen]);

  return (
    <div className={FIELD_COLUMN}>
      {/*
        The four values the form actually posts. Hidden rather than derived on
        the server from the typed text: the coordinates come from the place that
        was chosen, and re-geocoding a string server-side could resolve a
        different town than the one on screen.
      */}
      <input type="hidden" name="city" value={chosen?.city ?? ''} />
      <input type="hidden" name="countryCode" value={chosen?.countryCode ?? ''} />
      <input type="hidden" name="latitude" value={chosen === null ? '' : String(chosen.latitude)} />
      <input type="hidden" name="longitude" value={chosen === null ? '' : String(chosen.longitude)} />

      <label htmlFor={id} className={FIELD_LABEL}>
        {t('facilities.city')}
      </label>

      {chosen !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <MapPin className="size-4 text-primary" aria-hidden />
            {chosen.city}
            {chosen.countryCode !== null && (
              <span className="text-foreground-muted">({chosen.countryCode})</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setChosen(null);
              setQuery('');
            }}
            aria-label={t('facilities.clearCity')}
            className="inline-flex items-center gap-1 rounded text-sm text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X aria-hidden className="size-4" />
            {t('common.change')}
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('facilities.cityPlaceholder')}
            className={CONTROL_LINE}
            autoComplete="off"
          />

          {searching && (
            <p className="text-sm text-foreground-muted">{t('common.working')}</p>
          )}

          {failed && <p className="text-sm text-foreground-muted">{t('facilities.cityFailed')}</p>}

          {suggestions.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
              {suggestions.map((place) => (
                <li key={`${place.city}-${place.latitude}-${place.longitude}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setChosen(place);
                      setSuggestions([]);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <MapPin aria-hidden className="size-4 shrink-0 text-foreground-muted" />
                    <span>
                      {place.city}
                      {place.countryCode !== null && (
                        <span className="text-foreground-muted"> · {place.countryCode}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Visible text, not a placeholder: it explains what the field is for. */}
      <p className="text-sm text-foreground-muted">{t('facilities.cityHint')}</p>
    </div>
  );
}
