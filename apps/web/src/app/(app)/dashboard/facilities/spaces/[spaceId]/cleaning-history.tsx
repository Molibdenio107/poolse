'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import type { Cleaning } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { archiveCleaning } from '../../spaces.actions';

/**
 * Who cleaned this, and when. Reverse-chronological.
 *
 * **There is no edit control, and that is the design.** An entry is a claim
 * about a moment; editing one rewrites what a colleague said they did. A mistake
 * is deleted — owner/admin only — and deleting it puts the space back to overdue
 * if it was the only cleaning, which is the honest outcome.
 *
 * The timestamp is rendered by `useFormatter`, so it is shown in the reader's
 * locale from the UTC the API sent. Class schedules are where the timezone rule
 * bites hardest, but a cleaning at 23:40 on the 5th must not read as the 6th
 * either.
 */

const BUTTON =
  'inline-flex items-center gap-1 rounded p-1 text-foreground-muted transition-colors ' +
  'hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-primary';

export function CleaningHistory({
  spaceId,
  facilityId,
  cleanings,
  canManage,
}: {
  spaceId: string;
  facilityId: string;
  cleanings: Cleaning[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();
  const [removing, setRemoving] = useState<Cleaning | null>(null);
  const [working, setWorking] = useState(false);

  if (cleanings.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('spaces.noCleanings')}</p>;
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {cleanings.map((cleaning) => {
          const at = new Date(cleaning.performedAt);

          return (
            <li
              key={cleaning.id}
              className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-sm">
                  {/*
                    "Limpo por {nome} às {hora} do dia {data}". The word order
                    lives in the translation file, not here — English wants it
                    the other way round.

                    A null name is a membership nobody has named yet, which is a
                    pending invitation. It says "alguém" rather than rendering an
                    empty gap that reads as a broken row.
                  */}
                  {t('spaces.cleanedBy', {
                    name: cleaning.performedBy ?? t('spaces.someone'),
                    time: format.dateTime(at, { hour: '2-digit', minute: '2-digit' }),
                    date: format.dateTime(at, { day: 'numeric', month: 'long', year: 'numeric' }),
                  })}
                </p>

                {cleaning.note !== null && (
                  <p className="text-sm text-foreground-muted">{cleaning.note}</p>
                )}
              </div>

              {canManage && (
                <button
                  type="button"
                  onClick={() => setRemoving(cleaning)}
                  className={BUTTON}
                  aria-label={t('spaces.deleteCleaning')}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('spaces.deleteCleaning')}
        closeLabel={t('common.close')}
      >
        {/*
          Said plainly, because it is the surprising part: removing the last
          cleaning makes the space overdue again. That is correct — as far as
          anybody knows it has not been cleaned since the one before — but
          nobody would predict it from a delete button.
        */}
        <p className="text-sm">{t('spaces.confirmDeleteCleaning')}</p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={working}
            onClick={() => {
              const target = removing;
              if (target === null) return;
              setWorking(true);
              void archiveCleaning(spaceId, facilityId, target.id).then(() => {
                setWorking(false);
                setRemoving(null);
              });
            }}
            className="inline-flex h-control items-center rounded border border-border-strong px-3 text-sm hover:border-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {working ? t('common.working') : t('common.remove')}
          </button>
          <button
            type="button"
            onClick={() => setRemoving(null)}
            className="inline-flex h-control items-center rounded border border-border-strong px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
