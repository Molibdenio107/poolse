'use client';

import { startTransition, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useSavedAction } from '@/lib/saved';
import {
  previewFamilyInvitesAction,
  sendFamilyInvitesAction,
  type BulkState,
} from './family-bulk.actions';

const INITIAL: BulkState = { ok: false };
const BUTTON = 'inline-flex h-control items-center justify-center gap-2 rounded px-4 text-control disabled:opacity-60';

/**
 * *Convidar famílias* — POOLSE-129. Opens on the list's own filters, says what
 * would happen in figures, and sends only on the second press. Families with
 * an address get the email; those with only a phone stay on *Por convidar*,
 * because a link shared from the club's phone is one person at a time.
 */
export function FamilyBulkInvite({ search, levelId }: { search: string; levelId: string }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [preview, previewAction, previewing] = useSavedAction(previewFamilyInvitesAction, INITIAL);
  const [sent, sendAction, sending] = useSavedAction(sendFamilyInvitesAction, INITIAL);

  // Asked for afresh every time it opens: a preview from an hour ago is not
  // the list as it stands.
  useEffect(() => {
    if (!open) return;
    const form = new FormData();
    form.set('search', search);
    form.set('levelId', levelId);
    // Inside a transition: an action dispatched from an effect needs one.
    startTransition(() => previewAction(form));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open]);

  useEffect(() => {
    if (sent.committed === true) setOpen(false);
  }, [sent]);

  const figures = preview.figures;
  const over = figures !== undefined && figures.sentToday + figures.byEmail > figures.ceiling;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${BUTTON} border border-border bg-surface hover:bg-surface-muted`}
      >
        <Send className="size-4" aria-hidden />
        {t('familyBulk.open')}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('familyBulk.title')}
        description={t('familyBulk.description')}
        closeLabel={t('common.close')}
      >
        {previewing || figures === undefined ? (
          <p className="text-sm text-foreground-muted">
            {preview.errorKey === undefined ? t('common.working') : t(preview.errorKey, preview.values)}
          </p>
        ) : (
          <form action={sendAction} className="flex flex-col gap-4">
            <input type="hidden" name="search" value={search} />
            <input type="hidden" name="levelId" value={levelId} />
            <ul className="flex flex-col gap-1 text-sm">
              <li>{t('familyBulk.students', { count: figures.students })}</li>
              <li className="font-medium">{t('familyBulk.byEmail', { count: figures.byEmail })}</li>
              <li>{t('familyBulk.phoneOnly', { count: figures.phoneOnly })}</li>
              <li>{t('familyBulk.alreadyInvited', { count: figures.alreadyInvited })}</li>
              <li>{t('familyBulk.inApp', { count: figures.inApp })}</li>
            </ul>
            {over && (
              <p className="text-sm text-danger">
                {t('familyBulk.ceiling', {
                  ceiling: figures.ceiling,
                  sentToday: figures.sentToday,
                  asked: figures.byEmail,
                })}
              </p>
            )}
            {sent.errorKey !== undefined && <p className="text-sm text-danger">{t(sent.errorKey, sent.values)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`${BUTTON} border border-border bg-surface hover:bg-surface-muted`}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={sending || over || figures.byEmail === 0}
                className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}
              >
                {sending ? t('common.working') : t('familyBulk.send', { count: figures.byEmail })}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
