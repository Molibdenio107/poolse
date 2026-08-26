'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FormState } from '../../actions';
import {
  archiveLevelAction,
  createLevelAction,
  moveLevelAction,
} from '../students.actions';

const INITIAL: FormState = { ok: false };

export function CreateLevelForm({
  organizationId,
}: {
  organizationId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createLevelAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          required
          maxLength={120}
          aria-label={t('students.levelName')}
          placeholder={t('students.levelPlaceholder')}
          className="min-w-48 flex-1 rounded border border-border bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('students.addLevel')}
        </button>
      </div>
      <p className="text-sm text-foreground-muted">{t('students.addLevelHint')}</p>
      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">{t(state.errorKey)}</p>
      )}
    </form>
  );
}

/**
 * Moves one level a single place, by swapping it with its neighbour.
 *
 * Disabled at the ends rather than hidden, so the row does not change width as
 * you reorder and send the next button out from under the pointer.
 */
export function MoveLevelButton({
  organizationId,
  levelId,
  direction,
  disabled,
}: {
  organizationId: string;
  levelId: string;
  direction: 'up' | 'down';
  disabled: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useActionState(moveLevelAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="levelId" value={levelId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled || pending}
        aria-label={direction === 'up' ? t('students.moveUp') : t('students.moveDown')}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-30"
      >
        {direction === 'up' ? '↑' : '↓'}
      </button>
    </form>
  );
}

/**
 * Archiving a level does not archive the students in it — it leaves them without
 * one. That is recoverable and correct, but it is invisible unless the button
 * says so, so the confirmation counts them.
 */
export function ArchiveLevelButton({
  organizationId,
  levelId,
  name,
  studentCount,
}: {
  organizationId: string;
  levelId: string;
  name: string;
  studentCount: number;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(archiveLevelAction, INITIAL);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('students.archive')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="levelId" value={levelId} />
      <span className="text-sm text-foreground-muted">
        {studentCount > 0
          ? t('students.confirmArchiveLevel', { name, count: studentCount })
          : t('students.confirmArchiveEmptyLevel', { name })}
      </span>
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
