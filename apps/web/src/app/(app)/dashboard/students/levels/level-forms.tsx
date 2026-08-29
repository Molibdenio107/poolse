'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { StudentLevel } from '@/lib/api';
import { CONTROL_LINE, SelectField, TextField } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../../actions';
import {
  archiveLevelAction,
  countOutsideRangeAction,
  createLevelAction,
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
          className={cn(CONTROL_LINE, 'min-w-48 flex-1')}
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

/**
 * The two bounds — POOLSE-06, rebuilt in round 4.
 *
 * **Why it is no longer a picker.** It offered "sem limite", then one to eleven
 * months, then every year to a hundred: a hundred and twelve options in a native
 * select, which on a laptop is a scrollbar you drag past eighty entries you will
 * never pick to reach "6 anos". The list existed because the unit changes below
 * a year — a bare number cannot say whether 6 means months or years — and the
 * select answered that by enumerating every possibility.
 *
 * A number and a unit answer it directly, in two controls that are always the
 * same size no matter how far the range runs. Typing 6 and leaving the unit on
 * "anos" is two keystrokes; the old control could not be reached from the
 * keyboard in fewer than six.
 *
 * **The posted value has not changed.** A hidden field carries the month count,
 * computed here, so the action, the API and the column are all untouched and
 * still speak in months only. Nothing downstream has to learn about units.
 */
function AgeBound({
  name,
  label,
  months,
}: {
  name: string;
  label: string;
  months?: number | null | undefined;
}): React.ReactElement {
  const t = useTranslations();

  // Under a year is expressed in months, everything else in years — which is how
  // the club says it out loud, and how the old picker was grouped.
  const seedUnit = months === null || months === undefined || months >= 12 ? 'years' : 'months';
  const seedValue =
    months === null || months === undefined
      ? ''
      : String(seedUnit === 'months' ? months : Math.round(months / 12));

  const [value, setValue] = useState(seedValue);
  const [unit, setUnit] = useState(seedUnit);

  // Re-seed on a save that changed the level, and only then — the same rule
  // `useSeeded` follows, for the same reason: a re-render must not overwrite
  // what somebody is halfway through typing.
  const seeded = useRef<number | null | undefined>(months);
  useEffect(() => {
    if (seeded.current === months) return;
    seeded.current = months;
    setValue(seedValue);
    setUnit(seedUnit);
  }, [months, seedValue, seedUnit]);

  const trimmed = value.trim();
  // Empty stays empty: "no bound" is a real answer and must post as one rather
  // than as a zero, which would mean "from birth".
  const asMonths =
    trimmed === '' || Number.isNaN(Number(trimmed))
      ? ''
      : String(unit === 'months' ? Number(trimmed) : Number(trimmed) * 12);

  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name={name} value={asMonths} />
      <div className="flex items-end gap-2">
        <TextField
          name={`${name}Value`}
          label={label}
          type="number"
          initial={seedValue}
          onValueChange={setValue}
          placeholder={t('students.ageNoBound')}
          className="w-24"
        />
        <SelectField
          name={`${name}Unit`}
          label={t('students.ageUnit')}
          initial={seedUnit}
          onValueChange={setUnit}
          options={[
            { value: 'years', label: t('students.ageUnitYears') },
            { value: 'months', label: t('students.ageUnitMonths') },
          ]}
          className="w-32"
        />
      </div>
      {/* Visible text, not a placeholder: leaving it blank is a decision. */}
      <p className="text-xs text-foreground-muted">{t('students.ageBoundHint')}</p>
    </div>
  );
}

function AgeInputs({
  minAgeMonths,
  maxAgeMonths,
}: {
  minAgeMonths?: number | null;
  maxAgeMonths?: number | null;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-wrap gap-4">
      <AgeBound name="minAgeMonths" label={t('students.ageFrom')} months={minAgeMonths} />
      <AgeBound name="maxAgeMonths" label={t('students.ageTo')} months={maxAgeMonths} />
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

    const min = read('minAgeMonths');
    const max = read('maxAgeMonths');

    const narrower =
      (min !== null && (level.minAgeMonths === null || min > level.minAgeMonths)) ||
      (max !== null && (level.maxAgeMonths === null || max < level.maxAgeMonths));

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
          className={CONTROL_LINE}
        />

        <AgeInputs minAgeMonths={level.minAgeMonths} maxAgeMonths={level.maxAgeMonths} />

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


/*
 * `MoveLevelButton` used to be here — POOLSE-05 replaced it with drag and drop.
 *
 * It went rather than staying behind unused, along with its action and its
 * endpoint. A one-hop swap cannot express dragging a level from fifth to first,
 * and a control that still can would be a second way to order the same list —
 * the two would disagree the first time somebody used both.
 *
 * The reordering it did is not lost: `Reorderable` moves rows by pointer, by
 * finger and by keyboard, which is more ways than the arrows offered.
 */

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
