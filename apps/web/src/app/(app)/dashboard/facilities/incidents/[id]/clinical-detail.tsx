'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { TextAreaField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import { formatStamp } from '@/lib/date-format';
import type { IncidentDetail } from '@/lib/api';
import type { FormState } from '../../../actions';
import { addAddendumAction, readIncidentDetailAction } from '../incidents.actions';

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const TEXT_MAX = 5000;

/** An addendum written on this screen, before any re-read: its words, and no fabricated stamp. */
interface Written {
  body: string;
}

/**
 * The encrypted half of an incident — POOLSE-70, slice 1.
 *
 * **Read on request, and the request is said to be logged.** Each press of the
 * button is one POST and one `incident_detail.read` row; the sentence beside it
 * tells the reader so before they press, not after. Hiding it again forgets
 * the words in the browser; showing them again is a second read, logged again.
 *
 * **A correction is written here, never over the original.** It goes under the
 * same rule as reading — the owner, the admins and the author — so somebody who
 * cannot read the detail is not offered a way to append to it blind. One just
 * written is drawn under the detail as "added now by you" rather than re-reading
 * the whole record to fetch it back, because that re-read would be a log entry
 * nobody asked for.
 */
export function ClinicalDetail({
  incidentId,
  canRead,
}: {
  incidentId: string;
  /** The API's answer to the per-row rule. */
  canRead: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [written, setWritten] = useState<Written[]>([]);
  // Remounts the text box after a save, so it starts empty for the next one.
  const [round, setRound] = useState(0);

  const [state, add, adding] = useSavedAction<FormState, FormData>(
    async (previous, formData) => {
      const next = await addAddendumAction(incidentId, previous, formData);
      if (next.ok) {
        // Read from the submitted form, not from state: the words that were sent.
        const body = String(formData.get('body') ?? '').trim();
        setWritten((list) => [...list, { body }]);
        setRound((n) => n + 1);
      }
      return next;
    },
    { ok: false },
  );

  if (!canRead) {
    return (
      <section
        aria-labelledby="incident-clinical"
        className="flex flex-col gap-1 rounded border-2 border-border-strong bg-surface p-5"
      >
        <h2 id="incident-clinical" className="flex items-center gap-2 font-medium">
          <Lock aria-hidden className="size-4" />
          {t('incidents.clinicalTitle')}
        </h2>
        <p className="text-sm">{t('incidents.detailRefused')}</p>
      </section>
    );
  }

  const read = (): void => {
    setFailure(null);
    startReading(async () => {
      const result = await readIncidentDetailAction(incidentId);
      if (result.ok) {
        setDetail(result.detail);
        // The record now includes anything written here; drawing both would double it.
        setWritten([]);
      } else {
        setFailure(result.errorKey);
      }
    });
  };

  const addendumError = state.fields?.['body'];

  return (
    <section
      aria-labelledby="incident-clinical"
      className="flex flex-col gap-4 rounded border-2 border-border-strong bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="incident-clinical" className="flex items-center gap-2 font-medium">
          <Lock aria-hidden className="size-4" />
          {t('incidents.clinicalTitle')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('incidents.clinicalHint')}</p>
      </div>

      {detail === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={read} disabled={reading} className={PRIMARY}>
            {reading ? t('incidents.reading') : t('incidents.showDetail')}
          </button>
          <span className="text-sm text-foreground-muted">{t('incidents.eachReadLogged')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-foreground-muted">{t('incidents.field.whatHappened')}</dt>
              <dd className="whitespace-pre-wrap">{detail.whatHappened}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-foreground-muted">{t('incidents.field.injury')}</dt>
              <dd className="whitespace-pre-wrap">{detail.injury ?? t('incidents.nothingWritten')}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-foreground-muted">{t('incidents.field.firstAid')}</dt>
              <dd className="whitespace-pre-wrap">
                {detail.firstAid ?? t('incidents.nothingWritten')}
              </dd>
            </div>
          </dl>

          {(detail.addenda.length > 0 || written.length > 0) && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="text-sm font-medium">{t('incidents.addendaTitle')}</h3>
              <ol className="flex flex-col gap-3 text-sm">
                {detail.addenda.map((addendum, index) => (
                  <li key={addendum.id} className="flex flex-col gap-1">
                    <span className="text-foreground-muted">
                      {t('incidents.addendumLine', {
                        number: index + 1,
                        name: addendum.writtenByName ?? t('incidents.unknownPerson'),
                        at: formatStamp(addendum.createdAt),
                      })}
                    </span>
                    <span className="whitespace-pre-wrap">{addendum.body}</span>
                  </li>
                ))}
                {written.map((addendum, index) => (
                  <li key={`written-${index}`} className="flex flex-col gap-1">
                    <span className="text-foreground-muted">
                      {t('incidents.addendumJustNow', {
                        number: detail.addenda.length + index + 1,
                      })}
                    </span>
                    <span className="whitespace-pre-wrap">{addendum.body}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => {
                setDetail(null);
                setWritten([]);
              }}
              className={QUIET}
            >
              {t('incidents.hideDetail')}
            </button>
          </div>
        </div>
      )}

      {failure !== null && (
        <p role="alert" className="text-sm text-danger">
          {t(failure as never)}
        </p>
      )}

      <form action={add} className="flex flex-col gap-3 border-t border-border pt-4">
        <TextAreaField
          key={round}
          name="body"
          label={t('incidents.field.addendum')}
          hint={t('incidents.field.addendumHint')}
          rows={3}
          maxLength={TEXT_MAX}
          required
          error={addendumError === undefined ? undefined : t(addendumError as never)}
        />
        <div>
          <button type="submit" disabled={adding} className={QUIET}>
            {adding ? t('incidents.addingAddendum') : t('incidents.addAddendum')}
          </button>
        </div>
      </form>
    </section>
  );
}
