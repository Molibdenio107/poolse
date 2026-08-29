'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CONTROL_BLOCK, CONTROL_LINE } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { ConsentKind } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';
import {
  recordConsentAction,
  saveNotesAction,
  withdrawConsentAction,
} from './sensitive.actions';

const INITIAL: FormState = { ok: false };

function Problem({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;
  return (
    <p className="text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

/**
 * The medical notes box.
 *
 * Encrypted before it reaches the database and decrypted only for the people
 * allowed to see it — but on this screen it is just a textarea, and it should
 * be: an instructor checking whether a child is asthmatic before a lesson should
 * not have to think about any of that.
 */
export function MedicalNotesForm({
  organizationId,
  studentId,
  notes,
}: {
  organizationId: string;
  studentId: string;
  notes: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveNotesAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      <textarea
        name="medicalNotes"
        rows={5}
        maxLength={4000}
        defaultValue={notes ?? ''}
        placeholder={t('sensitive.notesPlaceholder')}
        className={CONTROL_BLOCK}
      />
      <p className="text-sm text-foreground-muted">{t('sensitive.notesHint')}</p>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>
      </div>

      {state.ok && <p className="text-sm text-success">{t('sensitive.saved')}</p>}
      <Problem state={state} />
    </form>
  );
}

/**
 * Recording a decision, not ticking a box.
 *
 * Granted and refused are both submit buttons, so the operator states which one
 * happened rather than leaving a default to speak for a guardian. The evidence
 * field is what makes the record worth anything a year later — "signed form
 * 12/09", "email from the mother".
 */
export function RecordConsentForm({
  organizationId,
  studentId,
  kinds,
}: {
  organizationId: string;
  studentId: string;
  kinds: ConsentKind[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(recordConsentAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      <div className="flex flex-wrap gap-2">
        <select name="kind" aria-label={t('sensitive.kind')} className={cn(CONTROL_LINE, 'min-w-44')}>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`sensitive.kinds.${kind}`)}
            </option>
          ))}
        </select>
        <input
          name="evidenceNote"
          maxLength={500}
          aria-label={t('sensitive.evidence')}
          placeholder={t('sensitive.evidencePlaceholder')}
          className={cn(CONTROL_LINE, 'min-w-48 flex-1')}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="granted"
          value="true"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('sensitive.recordGranted')}
        </button>
        <button
          type="submit"
          name="granted"
          value="false"
          disabled={pending}
          className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted disabled:opacity-60"
        >
          {t('sensitive.recordRefused')}
        </button>
      </div>

      <Problem state={state} />
    </form>
  );
}

/**
 * Withdrawal, confirmed, because it is the only change a consent record allows —
 * and it cannot be undone. Correcting a mistake means withdrawing and recording
 * a new decision, which leaves both in the history where an auditor can see them.
 */
export function WithdrawConsentButton({
  organizationId,
  studentId,
  consentId,
}: {
  organizationId: string;
  studentId: string;
  consentId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(withdrawConsentAction, INITIAL);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('sensitive.withdraw')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="consentId" value={consentId} />
      <span className="text-sm text-foreground-muted">{t('sensitive.confirmWithdraw')}</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-danger/50 px-2 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
      >
        {pending ? t('common.working') : t('facilities.confirmArchive')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:bg-surface-muted"
      >
        {t('common.cancel')}
      </button>
      {state.errorKey !== undefined && (
        <span className="text-sm text-danger">{t(state.errorKey)}</span>
      )}
    </form>
  );
}
