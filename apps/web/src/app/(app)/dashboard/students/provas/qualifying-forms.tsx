'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatSwimTime, INDIVIDUAL_EVENTS, parseSwimTime, type SwimEvent } from '@poolse/rules';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField, useSeeded, useSuccessKey } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { Course, EntryTime, FederationAgeGroup } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { FormState } from '../../actions';
import {
  archiveAgeGroupAction,
  archiveStandardAction,
  createAgeGroupAction,
  createStandardAction,
  setEntryTimesAction,
  updateAgeGroupAction,
  updateStandardAction,
} from './qualifying.actions';

/**
 * Mínimos — POOLSE-85. The club types the FPN's age groups and each
 * championship's entry times (Rui, 19-10-2026); nothing here is FPN data.
 */

const INITIAL: FormState = { ok: false };
const PRIMARY =
  'inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground hover:bg-primary/90 disabled:opacity-60';
const SECONDARY =
  'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted';
const DANGER =
  'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control text-foreground-muted hover:border-danger/50 hover:text-danger';
const COURSES: Course[] = ['scm', 'lcm'];

function fieldError(t: ReturnType<typeof useTranslations>, state: FormState, field: string): string | undefined {
  const key = state.fields?.[field];
  return key === undefined ? undefined : t(key);
}

function FormError({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && <span className="block text-foreground-muted">{state.detail}</span>}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Age groups
// ---------------------------------------------------------------------------

function AgeGroupFields({ state, group }: { state: FormState; group?: FederationAgeGroup }): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField
        name="name"
        label={t('qualifying.ageGroupName')}
        initial={group?.name ?? ''}
        placeholder={t('qualifying.ageGroupNamePlaceholder')}
        maxLength={80}
        required
        error={fieldError(t, state, 'name')}
      />
      <SelectField
        name="gender"
        label={t('qualifying.gender')}
        initial={group?.gender ?? ''}
        options={[
          { value: '', label: t('qualifying.genderBoth') },
          { value: 'female', label: t('qualifying.genderFemale') },
          { value: 'male', label: t('qualifying.genderMale') },
        ]}
      />
      <TextField
        name="bornFrom"
        label={t('qualifying.bornFrom')}
        initial={group?.bornFrom === null || group === undefined ? '' : String(group.bornFrom)}
        inputMode="numeric"
        maxLength={4}
        hint={t('qualifying.bornHint')}
        error={fieldError(t, state, 'bornFrom')}
      />
      <TextField
        name="bornTo"
        label={t('qualifying.bornTo')}
        initial={group?.bornTo === null || group === undefined ? '' : String(group.bornTo)}
        inputMode="numeric"
        maxLength={4}
        error={fieldError(t, state, 'bornTo')}
      />
    </div>
  );
}

export function CreateAgeGroupForm({
  organizationId,
  seasonId,
}: {
  organizationId: string;
  seasonId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createAgeGroupAction, INITIAL);
  // Typed into again after each save: a fresh form when one works, never after a refusal.
  const added = useSuccessKey(state);
  return (
    <form key={added} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <AgeGroupFields state={state} />
      <FormError state={state} />
      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t('common.working') : t('qualifying.addAgeGroup')}
        </button>
      </div>
    </form>
  );
}

export function EditAgeGroupButton({
  organizationId,
  group,
}: {
  organizationId: string;
  group: FederationAgeGroup;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useSavedAction(updateAgeGroupAction, INITIAL);
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={SECONDARY}>
        {t('common.edit')}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('qualifying.editAgeGroup')} closeLabel={t('common.close')}>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="id" value={group.id} />
          <AgeGroupFields state={state} group={group} />
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pending} className={PRIMARY}>
              {pending ? t('common.working') : t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Owner and admin. Takes the group's entry times with it, and says so first. */
export function ArchiveButton({
  organizationId,
  id,
  kind,
  name,
}: {
  organizationId: string;
  id: string;
  kind: 'ageGroup' | 'standard';
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useSavedAction(
    kind === 'ageGroup' ? archiveAgeGroupAction : archiveStandardAction,
    INITIAL,
  );
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={DANGER}>
        {t('qualifying.archive')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('qualifying.archive')}
        description={name}
        closeLabel={t('common.close')}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="id" value={id} />
          <p className="text-sm">
            {t(kind === 'ageGroup' ? 'qualifying.confirmArchiveAgeGroup' : 'qualifying.confirmArchiveStandard')}
          </p>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-control items-center justify-center rounded border border-danger/50 px-4 text-control text-danger hover:bg-danger/10 disabled:opacity-60"
            >
              {pending ? t('common.working') : t('qualifying.archive')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Standards
// ---------------------------------------------------------------------------

function StandardFields({
  state,
  standard,
}: {
  state: FormState;
  standard?: { name: string; windowFrom: string | null; windowTo: string | null };
}): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField
        name="name"
        label={t('qualifying.standardName')}
        initial={standard?.name ?? ''}
        placeholder={t('qualifying.standardNamePlaceholder')}
        maxLength={200}
        required
        error={fieldError(t, state, 'name')}
        className="sm:col-span-2"
      />
      <TextField
        name="windowFrom"
        type="date"
        label={t('qualifying.windowFrom')}
        initial={standard?.windowFrom ?? ''}
        hint={t('qualifying.windowHint')}
        error={fieldError(t, state, 'windowFrom')}
      />
      <TextField
        name="windowTo"
        type="date"
        label={t('qualifying.windowTo')}
        initial={standard?.windowTo ?? ''}
        error={fieldError(t, state, 'windowTo')}
      />
    </div>
  );
}

export function CreateStandardForm({
  organizationId,
  seasonId,
}: {
  organizationId: string;
  seasonId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createStandardAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <StandardFields state={state} />
      <FormError state={state} />
      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t('common.working') : t('qualifying.addStandard')}
        </button>
      </div>
    </form>
  );
}

export function EditStandardForm({
  organizationId,
  standard,
}: {
  organizationId: string;
  standard: { id: string; name: string; windowFrom: string | null; windowTo: string | null };
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(updateStandardAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={standard.id} />
      <StandardFields state={state} standard={standard} />
      <FormError state={state} />
      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t('common.working') : t('common.save')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The entry-times grid
// ---------------------------------------------------------------------------

const cellKey = (stroke: string, distanceM: number, course: Course): string => `${stroke}-${distanceM}-${course}`;

/**
 * One age group's column of entry times: the FPN's individual events down, the
 * two pool lengths across. A cell is what the coach types — `1:05.00` or
 * `28,91` — read by the same `parseSwimTime` the API uses, so the marker under
 * a cell here is the refusal the API would give. An empty cell clears it.
 */
export function EntryTimesGrid({
  organizationId,
  standardId,
  ageGroupId,
  times,
}: {
  organizationId: string;
  standardId: string;
  ageGroupId: string;
  times: EntryTime[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(setEntryTimesAction, INITIAL);

  // The FPN's events, plus any other event this group already has a time for.
  const events: SwimEvent[] = [...INDIVIDUAL_EVENTS];
  for (const time of times) {
    if (!events.some((e) => e.stroke === time.stroke && e.distanceM === time.distanceM)) {
      events.push({ stroke: time.stroke, distanceM: time.distanceM });
    }
  }

  const seed: Record<string, string> = {};
  for (const time of times) seed[cellKey(time.stroke, time.distanceM, time.course)] = formatSwimTime(time.timeMs);
  // One seeded value for the whole grid: it re-seeds when the saved times change.
  const [json, setJson] = useSeeded<string>(JSON.stringify(seed));
  const values = JSON.parse(json) as Record<string, string>;
  const setCell = (key: string, value: string): void => setJson(JSON.stringify({ ...values, [key]: value }));

  const unreadable = Object.values(values).some((value) => parseSwimTime(value) === null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="standardId" value={standardId} />
      <input type="hidden" name="ageGroupId" value={ageGroupId} />
      <p className="text-sm text-foreground-muted">{t('qualifying.gridHint')}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="py-2 pr-4 font-normal">
                {t('qualifying.event')}
              </th>
              {COURSES.map((course) => (
                <th key={course} scope="col" className="py-2 pr-4 font-normal">
                  {t(`progress.course.${course}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={`${event.stroke}-${event.distanceM}`} className="border-b border-border last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {t('qualifying.eventName', {
                    distance: event.distanceM,
                    stroke: t(`progress.strokes.${event.stroke}`),
                  })}
                </th>
                {COURSES.map((course) => {
                  const key = cellKey(event.stroke, event.distanceM, course);
                  const value = values[key] ?? '';
                  const server = state.fields?.[key];
                  const invalid = parseSwimTime(value) === null || server !== undefined;
                  const label = t('qualifying.cellLabel', {
                    distance: event.distanceM,
                    stroke: t(`progress.strokes.${event.stroke}`),
                    course: t(`progress.course.${course}`),
                  });
                  return (
                    <td key={course} className="py-1.5 pr-4 align-top">
                      <input
                        name={`t:${event.stroke}:${event.distanceM}:${course}`}
                        value={value}
                        onChange={(e) => setCell(key, e.target.value)}
                        aria-label={label}
                        aria-invalid={invalid || undefined}
                        aria-describedby={invalid ? `${key}-error` : undefined}
                        inputMode="decimal"
                        placeholder="0:00.00"
                        maxLength={10}
                        className={cn(
                          'h-control w-28 rounded border bg-surface px-3 font-mono text-control placeholder:text-foreground-muted/60',
                          invalid ? 'border-danger' : 'border-border',
                        )}
                      />
                      {invalid && (
                        <p id={`${key}-error`} className="mt-1 text-xs text-danger">
                          {t('qualifying.badTime')}
                        </p>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormError state={state} />
      <div>
        <button type="submit" disabled={pending || unreadable} className={PRIMARY}>
          {pending ? t('common.working') : t('qualifying.saveTimes')}
        </button>
      </div>
    </form>
  );
}
