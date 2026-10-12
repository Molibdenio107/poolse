'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { TextField } from '@/components/ui/field';
import type { PickOption } from './incidents.actions';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Find one person and hold their id in a hidden field — POOLSE-70.
 *
 * Receção's search, generalised over *what* is searched: a student, a member,
 * or a member of staff. Two characters before anything is asked, a pause while
 * typing, and a failed search says so with a retry — an empty list would read
 * as "nobody by that name", which is a different fact.
 *
 * The choice is drawn as the person's name with a way to change it, so the form
 * says who will be recorded rather than leaving the reader to trust a highlight.
 */
export function PersonPicker({
  name,
  label,
  search,
  error,
  hint,
}: {
  /** The hidden field the chosen id is posted under. */
  name: string;
  label: string;
  search: (query: string) => Promise<PickOption[] | null>;
  error?: string | undefined;
  hint?: string | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const errorId = useId();
  const [chosen, setChosen] = useState<PickOption | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickOption[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | 'done'>('idle');

  const run = useCallback(
    async (text: string) => {
      setState('loading');
      const found = await search(text);
      if (found === null) {
        setState('failed');
        return;
      }
      setResults(found);
      setState('done');
    },
    [search],
  );

  useEffect(() => {
    if (chosen !== null) return;
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      setState('idle');
      return;
    }
    const timer = setTimeout(() => void run(text), 250);
    return () => clearTimeout(timer);
  }, [query, run, chosen]);

  return (
    <div className="flex w-full min-w-0 max-w-form flex-col gap-2">
      <input type="hidden" name={name} value={chosen?.id ?? ''} />

      {chosen !== null ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-foreground-muted">{label}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{chosen.name}</span>
            <button
              type="button"
              onClick={() => {
                setChosen(null);
                setQuery('');
              }}
              className={QUIET}
            >
              <X aria-hidden className="size-4" />
              {t('common.change')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <TextField
            name={`${name}Search`}
            label={label}
            hint={hint ?? t('incidents.searchHint')}
            initial={query}
            onValueChange={setQuery}
            autoComplete="off"
            error={error}
            className="max-w-none"
          />

          {state === 'loading' && (
            <p className="text-sm text-foreground-muted">{t('incidents.searching')}</p>
          )}
          {state === 'failed' && (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
              {t('incidents.searchFailed')}
              <button type="button" onClick={() => void run(query.trim())} className={QUIET}>
                {t('incidents.retry')}
              </button>
            </p>
          )}
          {state === 'done' && results !== null && results.length === 0 && (
            <p className="text-sm text-foreground-muted">{t('incidents.noMatches')}</p>
          )}
          {state === 'done' && results !== null && results.length > 0 && (
            <ul className="divide-y divide-border rounded border border-border">
              {results.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(option)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Search aria-hidden className="size-4 text-foreground-muted" />
                      {option.name}
                    </span>
                    {option.detail !== null && option.detail !== '' && (
                      <span className="text-sm text-foreground-muted">{option.detail}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {chosen !== null && error !== undefined && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
