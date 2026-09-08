'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { FIELD_COLUMN, FIELD_LABEL, TextField } from '@/components/ui/field';
import type { InvoiceSeries } from '@/lib/api';
import type { FormState } from '../actions';
import { saveSeriesAction } from './invoices.actions';

/**
 * The numbering books this site holds.
 *
 * A settings block rather than a screen of its own: a club decides what its
 * numbers look like once and then never again, and a page for that would be a
 * page nobody visits twice.
 *
 * **The letter is fixed once a document has been issued under it.** Renaming it
 * would leave `FT A/1` and `FT B/2` in one series, neither of them wrong and
 * nothing able to report the discrepancy. The name may still change, because a
 * label is not part of any number.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function SeriesPanel({
  facilityId,
  series,
}: {
  facilityId: string;
  series: InvoiceSeries[];
}): React.ReactElement | null {
  const t = useTranslations();
  const [editing, setEditing] = useState<string | null>(null);

  if (series.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('invoices.seriesTitle')}
        </h2>
        <p className="mt-2 text-sm text-foreground-muted">{t('invoices.seriesHint')}</p>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {series.map((book) => (
          <li key={book.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span>
                <span className="font-medium">{book.name}</span>{' '}
                <span className="text-foreground-muted">
                  {t(`invoices.seriesKind.${book.kind}`)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                {/*
                  Visible text rather than a tooltip: how many documents a book
                  has issued is what decides whether its letter can still change,
                  and it is the number the refusal reports if somebody tries.
                */}
                <span className="text-sm text-foreground-muted">
                  {book.inUse
                    ? t('invoices.seriesNext', {
                        prefix: book.prefix,
                        number: book.nextNumber,
                        issued: book.nextNumber - 1,
                      })
                    : t('invoices.seriesEmpty', { prefix: book.prefix })}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(editing === book.id ? null : book.id)}
                  aria-expanded={editing === book.id}
                  aria-label={t('invoices.renameSeries')}
                  className={BUTTON_QUIET}
                >
                  <Pencil aria-hidden className="size-3.5" />
                </button>
              </span>
            </div>

            {editing === book.id && (
              <SeriesForm
                facilityId={facilityId}
                series={book}
                onDone={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeriesForm({
  facilityId,
  series,
  onDone,
}: {
  facilityId: string;
  series: InvoiceSeries;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await saveSeriesAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  const fields = state.fields ?? {};

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="seriesId" value={series.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="name"
          label={t('invoices.seriesName')}
          initial={series.name}
          error={fields['name'] === undefined ? undefined : t(fields['name'])}
          required
          className="max-w-none"
        />
        {series.inUse ? (
          /*
            Shown as text, with the reason beside it, rather than as a box that
            refuses.
            
            A control that simply vanishes leaves an operator wondering whether
            they imagined it; one that argues when they type into it wastes the
            typing. The value still travels, so saving a renamed book does not
            silently drop the letter it already has.
          */
          <div className={FIELD_COLUMN}>
            <span className={FIELD_LABEL}>{t('invoices.seriesPrefix')}</span>
            <p className="flex h-control items-center text-sm">{series.prefix}</p>
            <p className="text-sm text-foreground-muted">{t('invoices.prefixFixed')}</p>
            <input type="hidden" name="prefix" value={series.prefix} />
          </div>
        ) : (
          <TextField
            name="prefix"
            label={t('invoices.seriesPrefix')}
            initial={series.prefix}
            hint={t('invoices.prefixHint')}
            error={fields['prefix'] === undefined ? undefined : t(fields['prefix'])}
            className="max-w-none"
          />
        )}
      </div>

      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey, state.values ?? {})}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('common.save')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
