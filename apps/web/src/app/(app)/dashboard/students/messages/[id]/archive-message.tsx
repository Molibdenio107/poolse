'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { archiveMessageAction } from '../messages.actions';

/**
 * Archive a message — POOLSE-67.
 *
 * Hides it from the list and nothing else: the words and who they reached stay
 * in the database, which is why the dialog says so rather than asking somebody
 * to be sure about a deletion that is not one. Owner and admin; the API refuses
 * anybody else whether or not this button is drawn.
 */
export function ArchiveMessage({
  organizationId,
  messageId,
}: {
  organizationId: string;
  messageId: string;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirm = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
      >
        {t('messages.archive')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('messages.archiveTitle')}
        description={t('messages.archiveHint')}
        closeLabel={t('common.close')}
        initialFocus={confirm}
      >
        <div className="flex flex-wrap justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-border px-4 py-2 hover:bg-surface-muted"
          >
            {t('common.cancel')}
          </button>
          <button
            ref={confirm}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await archiveMessageAction(organizationId, messageId);
                setOpen(false);
                if (result.ok) {
                  toast.show('success', t('messages.archived'));
                  router.push('/dashboard/students/messages');
                } else {
                  toast.show('danger', t((result.errorKey ?? 'messages.error.archiveFailed') as never));
                }
              })
            }
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
          >
            {t('messages.archive')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
