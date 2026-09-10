'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { MaintenanceTask, TaskOption } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import {
  archiveTask,
  completeTask,
  removeCompletion,
  updateTask,
} from '../../maintenance.actions';

/**
 * The controls on a task's own page — slice 4.3.
 *
 * Client components because they submit; the page around them is a server
 * component that renders what the API decided, including whether any of these
 * should appear at all.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

const PRIMARY =
  'h-control rounded bg-primary px-4 text-sm font-medium text-primary-foreground ' +
  'transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * "Registar" — with a date and a note, unlike the one-tap button on the list.
 *
 * **The date is the point of this form.** A job done on Saturday and typed in on
 * Monday is the ordinary case, and the whole due calculation runs from when the
 * work happened rather than from when it was recorded — a task marked with
 * Monday's date would silently hide two days of the gap.
 *
 * Empty means now, so the fast path is still one press.
 */
export function CompleteForm({
  facilityId,
  taskId,
}: {
  facilityId: string;
  taskId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(completeTask, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="taskId" value={taskId} />

      <div className="flex flex-wrap gap-4">
        <TextField
          name="performedAt"
          label={t('maintenance.performedAt')}
          hint={t('maintenance.performedAtHint')}
          type="datetime-local"
          className="w-56"
          {...(state.fields?.['performedAt'] === undefined
            ? {}
            : { error: t('maintenance.performedAtInvalid') })}
        />
      </div>

      <TextAreaField name="note" label={t('maintenance.note')} rows={2} />

      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          <Check className="mr-1.5 inline size-4" aria-hidden="true" />
          {t('maintenance.record')}
        </button>
      </div>
    </form>
  );
}

/**
 * Remove one entry from the history.
 *
 * There is no edit, for the reason a cleaning has none: an entry is a claim
 * about a moment, and editing one rewrites what a colleague said they did. The
 * task goes straight back to due if this was its only completion, which is the
 * only honest answer.
 */
export function RemoveCompletion({
  facilityId,
  taskId,
  completionId,
}: {
  facilityId: string;
  taskId: string;
  completionId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeCompletion, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="completionId" value={completionId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('maintenance.removeEntry')}
        title={t('maintenance.removeEntry')}
        className="text-foreground-muted transition-colors hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </form>
  );
}

/**
 * Editing the plan: what it is, how often, whose, and whether it is running.
 *
 * Owner and admin only — the page decides whether to render this at all, and the
 * API refuses it again either way.
 *
 * **Pausing is a control of its own, not a deletion.** A task suspended while a
 * tank is drained is still part of the club's plan; archiving it would be saying
 * the club no longer does the job. The two read very differently on a screen and
 * they are two different statements.
 */
export function TaskAdmin({
  task,
  assignees,
}: {
  task: MaintenanceTask;
  assignees: TaskOption[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(updateTask, INITIAL);
  const [confirming, setConfirming] = useState(false);

  // The target picker is not offered here: moving a task from one tank to
  // another is rare enough that re-creating it is honest, and offering it would
  // mean shipping three whole pickers to a page that otherwise needs none.
  const target = task.spaceId ?? task.poolId ?? task.inventoryItemId;
  const kind =
    task.spaceId !== null ? 'space' : task.poolId !== null ? 'pool' : 'item';

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={task.facilityId} />
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="target" value={target === null ? '' : `${kind}:${target}`} />

        <div className="flex flex-wrap gap-4">
          <TextField
            name="title"
            label={t('maintenance.title')}
            initial={task.title}
            required
            {...(state.fields?.['title'] === undefined
              ? {}
              : { error: t('maintenance.titleRequired') })}
          />
          <TextField
            name="intervalDays"
            label={t('maintenance.every')}
            initial={String(task.intervalDays)}
            inputMode="numeric"
            className="w-40"
            {...(state.fields?.['intervalDays'] === undefined
              ? {}
              : { error: t('maintenance.everyInvalid') })}
          />
        </div>

        {/*
          Reassigning is why this form can edit at all: somebody leaves and their
          jobs have to go to a colleague. The list is whole and comes from the
          API — a picker built from a paginated endpoint would offer only page 1.

          A person who has left is not in it, so re-saving a task assigned to
          them moves it to whoever is chosen. That is the intended way out of the
          "belongs to nobody" state the header warns about.
        */}
        <SelectField
          name="assignedTo"
          label={t('maintenance.assignee')}
          hint={t('maintenance.assigneeHint')}
          initial={task.assignedTo === null ? '' : task.assignedTo}
          options={[
            { value: '', label: t('maintenance.unassigned') },
            ...assignees.map((person) => ({ value: person.id, label: person.name })),
            // The person who has left, kept as an option so opening the form
            // does not silently unassign the task the moment it is saved.
            ...(task.assignedTo !== null && task.assigneeArchived
              ? [
                  {
                    value: task.assignedTo,
                    label: t('maintenance.assigneeLeft', {
                      name: task.assignedToName ?? '—',
                    }),
                  },
                ]
              : []),
          ]}
        />

        <TextAreaField
          name="description"
          label={t('maintenance.description')}
          initial={task.description ?? ''}
          rows={3}
        />

        {/*
          Pausing, as a checkbox with its consequence written beside it. "Ativa"
          on its own says nothing about what changes; this says the job stops
          being due.
        */}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            value="true"
            defaultChecked={task.active}
            className="mt-0.5"
          />
          <span>
            {t('maintenance.active')}
            <span className="block text-foreground-muted">{t('maintenance.activeHint')}</span>
          </span>
        </label>
        {/*
          A checkbox posts nothing when it is unticked, which would read as
          "absent" and default back to active. This hidden field posts the false
          and the checkbox above overrides it — the same trick every tri-state
          form in this app uses rather than trusting an absence to mean anything.
        */}
        <input type="hidden" name="active" value="false" />

        {state.ok === false && state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey)}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={PRIMARY}>
            {t('common.save')}
          </button>
          <button type="button" onClick={() => setConfirming(true)} className={BUTTON}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('maintenance.remove')}
          </button>
        </div>
      </form>

      <ConfirmArchive
        task={task}
        open={confirming}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * "Are you sure" in the middle of the page, never `window.confirm`.
 *
 * `components/ui/dialog.tsx` portals to the body, so no ancestor's overflow or
 * z-index can clip it, and it gives focus back on close. Two confirmations in
 * two visual languages make an operator wonder whether they are being asked the
 * same thing.
 */
function ConfirmArchive({
  task,
  open,
  onClose,
}: {
  task: MaintenanceTask;
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(archiveTask, INITIAL);

  if (state.ok && open) onClose();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('maintenance.remove')}
      description={task.title}
      closeLabel={t('common.close')}
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={task.facilityId} />
        <input type="hidden" name="taskId" value={task.id} />

        {/* What is kept and what goes, in words, before the button is pressed. */}
        <p className="text-sm text-foreground-muted">{t('maintenance.removeHint')}</p>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-control rounded bg-danger px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('maintenance.remove')}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
