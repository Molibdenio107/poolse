'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CalendarClock, Check, PauseCircle, Plus } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { timeAgo } from '@/lib/relative-time';
import { withFrom } from '@/lib/back';
import type { MaintenanceTask, TaskList, TaskOption, TaskTarget } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../actions';
import { completeTask, createTask } from './maintenance.actions';

/**
 * Planned maintenance — slice 4.3.
 *
 * The jobs that come round again: contralavagem every Monday, service the dosing
 * pump quarterly, test the emergency lighting monthly. The unplanned half — "the
 * shower is broken" — is the issue list on each espaço, and the boundary is
 * whether it has a cadence.
 *
 * **The row is the whole feature.** What the job is, what it is about, whose it
 * is, and whether it is due — the four things somebody wants before deciding
 * what to do this morning. The state comes from the server already decided; this
 * component never computes due-ness, because there is one implementation of that
 * rule and it is in SQL.
 *
 * **Worst first, and paused last but never hidden.** A suspended job is a fact
 * about the site somebody may need to see; hiding it is how an operator ends up
 * creating a second one. The espaços list puts out-of-service rooms at the
 * bottom for the same reason.
 *
 * **"Feito" is one tap.** The server fills in who and when. A date and a note
 * are on the task's own page, where somebody recording Saturday's work on Monday
 * can say so — that is the case the whole due calculation depends on.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The state marker.
 *
 * Icon *and* words, never colour alone — this is the one thing on the row an
 * operator is meant to act on, and a red row says nothing to somebody who cannot
 * tell it from the row above. The colour is there too, because for everybody
 * else it is the fastest read on the page.
 */
function StateBadge({
  state,
  label,
}: {
  state: MaintenanceTask['state'];
  label: string;
}): React.ReactElement {
  const tone =
    state === 'due'
      ? 'bg-danger/10 text-danger'
      : state === 'paused'
        ? 'bg-foreground-muted/10 text-foreground-muted'
        : 'bg-success/10 text-success';

  const Icon = state === 'due' ? AlertTriangle : state === 'paused' ? PauseCircle : CalendarClock;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/** "Feito", as a form so it works before any JavaScript arrives. */
function DoneButton({
  facilityId,
  taskId,
  label,
}: {
  facilityId: string;
  taskId: string;
  label: string;
}): React.ReactElement {
  const [, action, pending] = useSavedAction(completeTask, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="taskId" value={taskId} />
      <button type="submit" disabled={pending} className={`${BUTTON} disabled:opacity-60`}>
        <Check className="size-4" aria-hidden="true" />
        {label}
      </button>
    </form>
  );
}

export function MaintenancePanel({
  facilityId,
  list,
}: {
  facilityId: string;
  list: TaskList;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [adding, setAdding] = useState(false);

  const due = list.tasks.filter((task) => task.state === 'due').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-muted">
          {/*
            The count that matters, in the header, so it is legible without
            reading the list — the same summary espaços puts in its own.
          */}
          {list.tasks.length === 0
            ? t('maintenance.hint')
            : t('maintenance.summary', { total: list.tasks.length, due })}
        </p>

        {list.canPlan && (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
            <Plus className="size-4" aria-hidden="true" />
            {t('maintenance.add')}
          </button>
        )}
      </div>

      {list.tasks.length === 0 ? (
        <div className="flex flex-col gap-2 rounded border border-dashed border-border p-4">
          <p className="text-sm font-medium">{t('maintenance.empty')}</p>
          <p className="text-sm text-foreground-muted">{t('maintenance.emptyHint')}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded border border-border">
          {list.tasks.map((task) => (
            <li key={task.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={withFrom(
                      `/dashboard/facilities/tasks/${task.id}`,
                      `/dashboard/facilities/${facilityId}`,
                    )}
                    className="font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {task.title}
                  </Link>
                  <StateBadge
                    state={task.state}
                    label={
                      task.state === 'due'
                        ? task.daysOverdue > 0
                          ? t('maintenance.dueBy', { days: task.daysOverdue })
                          : t('maintenance.due')
                        : task.state === 'paused'
                          ? t('maintenance.paused')
                          : t('maintenance.scheduled')
                    }
                  />
                </span>

                {list.canComplete && task.state !== 'paused' && (
                  <DoneButton
                    facilityId={facilityId}
                    taskId={task.id}
                    label={t('maintenance.done')}
                  />
                )}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground-muted">
                <span>{t('maintenance.everyDays', { days: task.intervalDays })}</span>

                {/* What it is about, where it has one. */}
                {(task.spaceName ?? task.poolName ?? task.inventoryItemName) !== null && (
                  <span>{task.spaceName ?? task.poolName ?? task.inventoryItemName}</span>
                )}

                <span>
                  {task.assignedToName === null
                    ? t('maintenance.unassigned')
                    : task.assigneeArchived
                      ? // Not reassigned automatically — that would be Poolse
                        // deciding who does the work — but said plainly, or the
                        // job silently belongs to nobody.
                        t('maintenance.assigneeLeft', { name: task.assignedToName })
                      : t('maintenance.assignedTo', { name: task.assignedToName })}
                </span>

                <span>
                  {task.lastDoneAt === null
                    ? t('maintenance.neverDone')
                    : t('maintenance.lastDone', {
                        ago: timeAgo(task.lastDoneAt, locale),
                        name: task.lastDoneByName ?? '—',
                      })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.canPlan && (
        <TaskDialog
          facilityId={facilityId}
          assignees={list.assignees ?? []}
          targets={list.targets ?? []}
          open={adding}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/**
 * A new task.
 *
 * **One target picker, not three.** The API refuses a task that is about both a
 * tank and a room; offering three dropdowns would let a screen build exactly the
 * request the server rejects, so the three columns arrive here as one list of
 * options carrying their own kind.
 *
 * `TextField` for the cadence rather than `type="number"`, per POOLSE-QA-07: a
 * number input refuses silently and the form then does nothing with no
 * explanation. The API validates it and names the field.
 */
function TaskDialog({
  facilityId,
  assignees,
  targets,
  open,
  onClose,
}: {
  facilityId: string;
  assignees: TaskOption[];
  targets: TaskTarget[];
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createTask, INITIAL);

  // Closed by the state it produced, during render, exactly as the espaços
  // dialog is — a save that worked should not leave the form sitting open over
  // the list it just changed.
  if (state.ok && open) onClose();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('maintenance.add')}
      closeLabel={t('common.close')}
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />

        <TextField
          name="title"
          label={t('maintenance.title')}
          required
          {...(state.fields?.['title'] === undefined
            ? {}
            : { error: t('maintenance.titleRequired') })}
        />

        <TextField
          name="intervalDays"
          label={t('maintenance.every')}
          hint={t('maintenance.everyHint')}
          inputMode="numeric"
          {...(state.fields?.['intervalDays'] === undefined
            ? {}
            : { error: t('maintenance.everyInvalid') })}
        />

        <SelectField
          name="target"
          label={t('maintenance.about')}
          hint={t('maintenance.aboutHint')}
          options={[
            { value: '', label: t('maintenance.aboutSite') },
            ...targets.map((target) => ({
              value: `${target.kind}:${target.id}`,
              label: `${t(`maintenance.kind.${target.kind}`)} — ${target.name}`,
            })),
          ]}
        />

        <SelectField
          name="assignedTo"
          label={t('maintenance.assignee')}
          hint={t('maintenance.assigneeHint')}
          options={[
            { value: '', label: t('maintenance.unassigned') },
            ...assignees.map((person) => ({ value: person.id, label: person.name })),
          ]}
        />

        <TextAreaField name="description" label={t('maintenance.description')} rows={3} />

        {state.ok === false && state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey)}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-control rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('common.save')}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
