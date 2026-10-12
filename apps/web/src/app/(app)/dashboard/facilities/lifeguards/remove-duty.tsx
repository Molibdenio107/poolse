'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { removeDutyAction } from './roster.actions';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Take a duty off the roster — owner and admin.
 *
 * Asked in a dialog, which names the person, the hours and the day, because the
 * button sits in a row of several and "remove" alone does not say which. The
 * API archives the duty, so who was on duty last Saturday stays answerable.
 */
export function RemoveDuty({
  dutyId,
  description,
}: {
  dutyId: string;
  /** The sentence naming the duty, composed by the server page. */
  description: string;
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
        {t('common.remove')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('roster.removeTitle')}
        description={description}
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
                const result = await removeDutyAction(dutyId);
                setOpen(false);
                if (result.ok) {
                  toast.show('success', t('roster.removed'));
                  router.refresh();
                } else {
                  toast.show(
                    'danger',
                    t((result.errorKey ?? 'roster.error.removeFailed') as never),
                  );
                }
              })
            }
            className={PRIMARY}
          >
            {t('common.remove')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
