'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { FacilityDay } from '@/lib/api';
import { CONTROL_LINE, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { saveHoursAction } from './facility.actions';

/**
 * When this site is open — round 4.
 *
 * The ask was "let me disable Sunday". What it needs to be, to be worth having,
 * is the site's standing rules in one place, because the same answer is wanted
 * by turmas today and by maintenance windows later. So this is the configuration
 * block, and the weekly grid is its first content rather than its whole purpose.
 *
 * **A tab on the site, not a menu item.** These rules belong to a facility the
 * way an address does. A "Definições" section in the sidebar would put them two
 * clicks from the thing they describe and start a settings area that everything
 * else then drifts into — the same reasoning that kept Reposições under Turmas.
 *
 * **The whole week saves at once.** Seven independent saves can fail on the
 * fourth and leave a screen showing a week that was never true. One button, one
 * request, one audit entry that reads as a decision.
 *
 * **Closing a day warns rather than refuses.** An operator who closes Sunday and
 * has three turmas on it is told so, right there, and then decides — the count
 * comes down with the row for exactly this. Refusing the change would deadlock
 * them: they cannot close the day until the classes move, and the reason the
 * classes are moving is that the day is closing. What the change does do is stop
 * the *next* class, which the database enforces on `class_schedule` rather than
 * here — a control that is merely hidden is not a rule.
 */
export function HoursPanel({
  organizationId,
  facilityId,
  hours,
  canManage,
}: {
  organizationId: string;
  facilityId: string;
  hours: FacilityDay[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();

  /*
   * Draft state, seeded once. The same rule as the form fields in `field.tsx`:
   * re-seeding on every render would fight somebody mid-edit, and a save that
   * fails must leave what they typed alone.
   */
  const [days, setDays] = useState<FacilityDay[]>(hours);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = days.some((day, index) => {
    const original = hours[index];
    return (
      original === undefined ||
      day.available !== original.available ||
      day.opensAt !== original.opensAt ||
      day.closesAt !== original.closesAt
    );
  });

  function edit(weekday: number, patch: Partial<FacilityDay>): void {
    setSaved(false);
    setErrorKey(null);
    setDays((current) =>
      current.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
    );
  }

  /**
   * Copy Monday's times onto every other day the site opens — round 5.
   *
   * Most pools keep one timetable all week and were typing the same two times
   * six times over. Monday is the source because it is the first row and the one
   * people fill in first; there is no picker for which day to copy from, because
   * a second control to answer a question nobody asks is worse than the typing.
   *
   * **It copies the times, never the switch.** A site that closes on Sunday
   * stays closed on Sunday: `available` is a decision per day, and a button that
   * quietly reopened a day somebody had shut would be the most destructive thing
   * on this panel. Days that are off keep their own times too, so turning one
   * back on does not reveal Monday's hours it never agreed to.
   *
   * It only stages the change — nothing is written until Save, so a mis-click is
   * undone by leaving the page.
   */
  function copyMonday(): void {
    const monday = days.find((day) => day.weekday === 1);
    if (monday === undefined) return;

    setSaved(false);
    setErrorKey(null);
    setDays((current) =>
      current.map((day) =>
        day.weekday === 1 || !day.available
          ? day
          : { ...day, opensAt: monday.opensAt, closesAt: monday.closesAt },
      ),
    );
  }

  // Only worth offering when some other open day disagrees with Monday.
  const canCopy =
    days.find((day) => day.weekday === 1)?.available === true &&
    days.some(
      (day) =>
        day.weekday !== 1 &&
        day.available &&
        (day.opensAt !== days[0]?.opensAt || day.closesAt !== days[0]?.closesAt),
    );

  function save(): void {
    setErrorKey(null);

    startTransition(async () => {
      const result = await saveHoursAction({
        organizationId,
        facilityId,
        days: days.map(({ weekday, available, opensAt, closesAt }) => ({
          weekday,
          available,
          opensAt,
          closesAt,
        })),
      });

      if (result.ok) setSaved(true);
      else setErrorKey(result.errorKey);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground-muted">{t('facilities.hoursHint')}</p>

        {canManage && canCopy && (
          <button
            type="button"
            onClick={copyMonday}
            className="shrink-0 rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('facilities.copyMonday')}
          </button>
        )}
      </div>

      {canManage && canCopy && (
        <p className="text-sm text-foreground-muted">{t('facilities.copyMondayHint')}</p>
      )}

      <ul className="flex flex-col divide-y divide-border">
        {days.map((day) => {
          const closing = !day.available && day.scheduledClasses > 0;

          return (
            <li key={day.weekday} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                {/*
                  The switch is a checkbox with a real label, not a styled div.
                  It is the control the whole feature exists for, and it has to
                  be reachable by keyboard and announced as what it is.
                */}
                <label className="flex min-w-40 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={day.available}
                    disabled={!canManage || pending}
                    onChange={(event) => edit(day.weekday, { available: event.target.checked })}
                    className="size-4 accent-primary"
                  />
                  <span className={cn('font-medium', !day.available && 'text-foreground-muted')}>
                    {t(`week.${day.weekday}`)}
                  </span>
                </label>

                {day.available ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`opens-${day.weekday}`}
                        className={FIELD_LABEL}
                      >
                        {t('facilities.opensAt')}
                      </label>
                      <input
                        id={`opens-${day.weekday}`}
                        type="time"
                        value={day.opensAt}
                        disabled={!canManage || pending}
                        onChange={(event) => edit(day.weekday, { opensAt: event.target.value })}
                        className={cn(CONTROL_LINE, 'w-28')}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`closes-${day.weekday}`}
                        className={FIELD_LABEL}
                      >
                        {t('facilities.closesAt')}
                      </label>
                      <input
                        id={`closes-${day.weekday}`}
                        type="time"
                        value={day.closesAt}
                        disabled={!canManage || pending}
                        onChange={(event) => edit(day.weekday, { closesAt: event.target.value })}
                        className={cn(CONTROL_LINE, 'w-28')}
                      />
                    </div>
                  </>
                ) : (
                  <span className="text-sm text-foreground-muted">{t('facilities.dayClosed')}</span>
                )}
              </div>

              {/*
                The consequence, before it is committed rather than after. The
                count is the site's own turma slots on this weekday, which is why
                the API sends it down with the row.
              */}
              {closing && (
                <p className="text-sm text-warning">
                  {t('facilities.dayHasClasses', { count: day.scheduledClasses })}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {pending ? t('common.working') : t('common.save')}
          </button>

          {/*
            `aria-live` on a container that is always present, not on one that
            appears — a region added at the same moment as its content is a
            region assistive technology was not watching.
          */}
          <span aria-live="polite" className="text-sm">
            {errorKey !== null && <span className="text-danger">{t(errorKey)}</span>}
            {errorKey === null && saved && (
              <span className="text-foreground-muted">{t('facilities.hoursSaved')}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
