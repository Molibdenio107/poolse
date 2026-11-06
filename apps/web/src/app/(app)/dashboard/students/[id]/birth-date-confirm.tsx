'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/confirm-action';
import { FromLink } from '@/components/from-link';
import { formatDate } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { confirmBirthDateAction } from './submissions.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';

/**
 * *Data de nascimento por confirmar* — POOLSE-186. Only a date the person gave in
 * the app shows this, so a record the office typed stays quiet. It warns and
 * blocks nothing; to correct the date, the form on *Geral* saves it.
 *
 * **The check is against the ID, so the button goes there** (POOLSE-190, Rui
 * 06-11-2026): with `documentHref` and a document to see, it opens it, and the
 * confirm sits beside the document, so nobody confirms without looking. Without
 * `documentHref` this *is* that banner, beside the document. With no ID anywhere
 * it says so and confirms directly.
 */
export function BirthDateConfirm({
  studentId,
  birthDate,
  idDocument,
  documentHref,
}: {
  studentId: string;
  birthDate: string | null;
  idDocument: 'pending' | 'on_file' | 'none';
  documentHref?: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(confirmBirthDateAction, INITIAL);
  const beside = documentHref === undefined;
  const hint = idDocument === 'none' ? 'hintNoDocument' : beside ? 'hintBeside' : 'hint';
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-primary bg-primary/[0.08] p-4">
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Badge tone="pending">{t('birthDateConfirm.pending')}</Badge>
        {birthDate !== null && (
          <p className="text-sm font-medium">{t('birthDateConfirm.declaredDate', { date: formatDate(birthDate) })}</p>
        )}
        <p className="text-sm">{t(`birthDateConfirm.${hint}`)}</p>
      </div>
      {!beside && idDocument !== 'none' ? (
        <FromLink href={documentHref} className={BUTTON}>
          {t('birthDateConfirm.confirm')}
        </FromLink>
      ) : (
        <ConfirmAction
          action={action}
          pending={pending}
          fields={{ studentId }}
          title={t('birthDateConfirm.confirmTitle')}
          message={t(beside ? 'birthDateConfirm.confirmMessageBeside' : 'birthDateConfirm.confirmMessage')}
          confirmLabel={t('birthDateConfirm.confirm')}
          trigger={t('birthDateConfirm.confirm')}
          triggerClassName={BUTTON}
        />
      )}
    </div>
  );
}
