'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import { ConfirmButton } from '@/components/confirm-action';
import { Archive } from 'lucide-react';
import { ARCHIVE_TRIGGER, ARCHIVE_ICON } from '@/lib/archive-trigger';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { archiveFeedbackAction } from '@/app/(app)/dashboard/feedback.actions';

const INITIAL: FormState = { ok: false };

/**
 * Arquivar, on one feedback — owner and admin (POOLSE-116). It asks first
 * (Rui, 04-11-2026), even though the toast's *Anular* and Arquivados can
 * bring it back: no decision runs on a stray click.
 */
export function ArchiveFeedbackButton({
  feedbackId,
  label,
}: {
  feedbackId: string;
  /** Whose answer this archives — a row of buttons all called "Arquivar" says nothing to a screen reader. */
  label: string;
}): React.ReactElement {
  const t = useTranslations();
  const path = usePathname();
  const [, action, pending] = useSavedAction(archiveFeedbackAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <input type="hidden" name="path" value={path} />
      <ConfirmButton
        title={t('confirm.instalacoes.feedbackArchiveTitle')}
        message={t('confirm.instalacoes.feedbackArchiveMessage')}
        confirmLabel={t('feedback.archive')}
        tone="danger"
        disabled={pending}
        ariaLabel={label}
        className={ARCHIVE_TRIGGER}
      >
        <Archive aria-hidden className={ARCHIVE_ICON} />
        {t('feedback.archive')}
      </ConfirmButton>
    </form>
  );
}
