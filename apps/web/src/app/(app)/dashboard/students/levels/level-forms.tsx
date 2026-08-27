'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { StudentLevel } from '@/lib/api';
import type { FormState } from '../../actions';
import {
  archiveLevelAction,
  countOutsideRangeAction,
  createLevelAction,
  moveLevelAction,
  renameLevelAction,
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

      {/* Optional on creation. A club that has never thought about ages should
          not be made to decide before it can add "Iniciação". */}
      <AgeInputs />

      <p className="text-sm text-foreground-muted">{t('students.addLevelHint')}</p>
      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">{t(state.errorKey)}</p>
      )}
    </form>
  );
}

/** The two bounds, side by side. Both optional, and empty means "no bound". */
function AgeInputs({
  minAgeYears,
  maxAgeYears,
}: {
  minAgeYears?: number | null;
  maxAgeYears?: number | null;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-wrap gap-2">
      <label className="flex items-center gap-2 text-sm text-foreground-muted">
        {t('students.ageFrom')}
        <input
          name="minAgeYears"
          type="number"
          min={0}
          max={120}
          defaultValue={minAgeYears ?? ''}
          className="w-20 rounded border border-border bg-background px-2 py-1.5 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground-muted">
        {t('students.ageTo')}
        <input
          name="maxAgeYears"
          type="number"
          min={0}
          max={120}
          defaultValue={maxAgeYears ?? ''}
          className="w-20 rounded border border-border bg-background px-2 py-1.5 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </label>
    </div>
  );
}

/**
 * Edit a level's name and age range — backlog round 4, ticket 4.
 *
 * The narrowing count is the point of this form. Tightening "3–5 anos" to "3–4"
 * is a decision with consequences for real children, and an operator should be
 * told how many before saving rather than discovering it on the register
 * afterwards. Saving still removes nobody: age drifts, a child turns six
 * mid-season, and when they move up is the club's call.
 */
export function EditLevelForm({
  organizationId,
  level,
}: {
  organizationId: string;
  level: StudentLevel;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(renameLevelAction, INITIAL);
  const [outside, setOutside] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  /*
   * Asked as the bounds change, debounced, and only when they have actually
   * narrowed. Widening a range cannot put anybody outside it, so asking would
   * be a round trip whose answer is always zero.
   */
  function preview(): void {
    const form = panel.current?.querySelector('form');
    if (!form) return;

    const data = new FormData(form);
    const read = (field: string): number | null => {
      const raw = String(data.get(field) ?? '').trim();
      return raw === '' ? null : Number(raw);
    };

    const min = read('minAgeYears');
    const max = read('maxAgeYears');

    const narrower =
      (min !== null && (level.minAgeYears === null || min > level.minAgeYears)) ||
      (max !== null && (level.maxAgeYears === null || max < level.maxAgeYears));

    if (!narrower) {
      setOutside(null);
      return;
    }

    void countOutsideRangeAction(organizationId, level.id, min, max)
      .then(setOutside)
      // A failed preview must not stop somebody saving. They lose the warning,
      // not the form.
      .catch(() => setOutside(null));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('students.editLevel')}
      </button>
    );
  }

  return (
    <div
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
      className="flex w-full flex-col gap-3 rounded border border-border bg-surface-muted p-3"
    >
      <form action={action} onChange={preview} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="levelId" value={level.id} />

        <input
          name="name"
          required
          maxLength={120}
          defaultValue={level.name}
          aria-label={t('students.levelName')}
          className="rounded border border-border bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />

        <AgeInputs minAgeYears={level.minAgeYears} maxAgeYears={level.maxAgeYears} />

        {outside !== null && outside > 0 && (
          <p className="rounded bg-warning/10 px-3 py-2 text-sm text-warning">
            {t('students.wouldFallOutside', { count: outside })}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
          >
            {pending ? t('common.working') : t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded text-sm text-foreground-muted hover:text-foreground"
          >
            {t('common.cancel')}
          </button>
          {state.errorKey !== undefined && (
            <span className="text-sm text-danger">{t(state.errorKey)}</span>
          )}
        </div>
      </form>
    </div>
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
