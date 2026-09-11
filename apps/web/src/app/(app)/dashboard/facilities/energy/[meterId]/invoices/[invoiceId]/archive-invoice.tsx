'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import type { FormState } from '../../../../../actions';
import { archiveInvoiceAction } from '../../../invoice.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

/** "Are you sure" in a dialog, never `window.confirm`; back to the meter once it is gone. */
export function ArchiveInvoice({
  invoiceId,
  meterId,
  facilityId,
}: {
  invoiceId: string;
  meterId: string;
  facilityId: string;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useSavedAction(archiveInvoiceAction, INITIAL);

  useEffect(() => {
    if (state.ok) router.push(`/dashboard/facilities/energy/${meterId}`);
  }, [state.ok, meterId, router]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
        <Trash2 className="size-4" aria-hidden="true" />
        {t('energy.invoice.remove')}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('energy.invoice.remove')} closeLabel={t('common.close')}>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="meterId" value={meterId} />
          <input type="hidden" name="facilityId" value={facilityId} />
          <p className="text-sm text-foreground-muted">{t('energy.invoice.removeConfirm')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="h-control rounded bg-danger px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('energy.invoice.remove')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
