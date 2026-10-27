'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { archiveFeedbackAction } from '@/app/(app)/dashboard/feedback.actions';

const INITIAL: FormState = { ok: false };

/**
 * Arquivar, on one feedback — owner and admin (POOLSE-116). No dialog: it is
 * one click back through the toast's *Anular* and from Arquivados.
 */
export function ArchiveFeedbackButton({ feedbackId }: { feedbackId: string }): React.ReactElement {
  const t = useTranslations();
  const path = usePathname();
  const [, action, pending] = useSavedAction(archiveFeedbackAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <input type="hidden" name="path" value={path} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center rounded border border-border px-4 text-control text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-60"
      >
        {t('feedback.archive')}
      </button>
    </form>
  );
}
