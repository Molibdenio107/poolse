'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { CopyButton } from '@/components/payment-destinations';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { regenerateInboxAddressAction } from './meets.actions';

/**
 * Where a club finds a meet's LENEX file: the FPN's site, whose competitions
 * publish their results — POOLSE-111. One constant, so a better address (a
 * results page, a ranking export) is a one-line change.
 */
const FPN_RESULTS_URL = 'https://fpnatacao.pt/';

const INITIAL: FormState = { ok: false };
const LINK =
  'rounded text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Como obter os resultados* — POOLSE-114 BA 6.
 *
 * Three short items in order: download from the FPN and drop it here; or
 * forward the email to the club's address and confirm it here; and who may
 * send, with why Poolse does not fetch from the FPN itself. A dialog rather
 * than a tooltip, because this is information and a tooltip never carries
 * information. Its trigger is visible text.
 *
 * The owner and the admins may make a new address here — the old one stops at
 * once, which is the whole point of the button and also why it asks first.
 */
export function ResultsHelp({
  organizationId,
  address,
  receiving,
  canManage,
}: {
  organizationId: string;
  address: string | null;
  receiving: boolean;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useSavedAction(regenerateInboxAddressAction, INITIAL);
  useEffect(() => {
    if (state.ok) setConfirming(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex w-fit items-center gap-1.5 text-sm coarse:-my-3 coarse:py-3 ${LINK}`}
      >
        <Info aria-hidden className="size-4" />
        {t('meetInbox.help.open')}
      </button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirming(false);
        }}
        title={t('meetInbox.help.title')}
        closeLabel={t('common.close')}
      >
        <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm">
          <li>
            {t('meetInbox.help.download')}{' '}
            <a href={FPN_RESULTS_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
              {t('meetInbox.help.fpnLink')}
            </a>
          </li>
          {/* A flex column inside the item, never on it: a flex `li` loses its number. */}
          <li>
            <div className="flex flex-col gap-2">
              {address !== null && receiving ? (
                <>
                  <span>{t('meetInbox.help.forward')}</span>
                  <span className="flex flex-wrap items-center gap-x-2 rounded bg-surface-muted px-3 py-1">
                    <span className="break-all font-mono">{address}</span>
                    <CopyButton value={address} label={t('meetInbox.help.copy')} />
                  </span>
                  <span>{t('meetInbox.help.forwardThen')}</span>
                  {canManage && !confirming && (
                    <button type="button" className={`${QUIET} w-fit`} onClick={() => setConfirming(true)}>
                      {t('meetInbox.help.regenerate')}
                    </button>
                  )}
                  {canManage && confirming && (
                    <form action={action} className="flex flex-col gap-2 rounded border border-border p-3">
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <p>{t('meetInbox.help.regenerateConfirm')}</p>
                      {state.errorKey !== undefined && <p className="text-danger">{t(state.errorKey)}</p>}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={pending}
                          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
                        >
                          {pending ? t('common.working') : t('meetInbox.help.regenerateYes')}
                        </button>
                        <button type="button" className={QUIET} onClick={() => setConfirming(false)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : (
                <span>{t('meetInbox.help.notReceiving')}</span>
              )}
            </div>
          </li>
          <li>{t('meetInbox.help.who')}</li>
        </ol>
      </Dialog>
    </>
  );
}
