'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { archiveIncidentAction } from '../incidents.actions';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Archive an incident — POOLSE-70. Owner and admin.
 *
 * Takes it off the site's list and nothing else: the record, its detail and
 * its addenda stay, which is why the dialog says so rather than asking somebody
 * to be sure about a deletion that is not one. The API refuses anybody else
 * whether or not this button is drawn.
 */
export function ArchiveIncident({
  incidentId,
  listHref,
}: {
  incidentId: string;
  listHref: string;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirm = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={QUIET}>
        {t('incidents.archive')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('incidents.archiveTitle')}
        description={t('incidents.archiveHint')}
        closeLabel={t('common.close')}
        initialFocus={confirm}
      >
        <div className="flex flex-wrap justify-end gap-2 text-sm">
          <button type="button" onClick={() => setOpen(false)} className={QUIET}>
            {t('common.cancel')}
          </button>
          <button
            ref={confirm}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await archiveIncidentAction(incidentId);
                setOpen(false);
                if (result.ok) {
                  toast.show('success', t('incidents.archived'));
                  router.push(listHref);
                } else {
                  toast.show(
                    'danger',
                    t((result.errorKey ?? 'incidents.error.archiveFailed') as never),
                  );
                }
              })
            }
            className={PRIMARY}
          >
            {t('incidents.archive')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
