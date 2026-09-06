'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { timeAgo } from '@/lib/relative-time';
import type { Space } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { archiveSpace, updateSpace } from '../../spaces.actions';
import { SPACE_TYPES } from '../../spaces-panel';

/**
 * The header: what this space is, and whether it needs attention.
 *
 * Everything an operator standing in the doorway wants before doing anything —
 * the schedule it is held to, when it was last done, and whether that is now
 * overdue. All of it visible text; none of it in a tooltip. A tooltip may
 * explain a control, never carry the fact.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

export function SpaceHeader({
  space,
  canManage,
}: {
  space: Space;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [state, dispatch, pending] = useSavedAction<FormState, FormData>(
    updateSpace.bind(null, space.id, space.facilityId),
    INITIAL,
  );

  if (state.ok && editing) setEditing(false);

  const ago = timeAgo(space.lastCleanedAt, locale);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{space.name}</h2>
            {!space.active && (
              <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-xs text-foreground-muted">
                {t('spaces.inactive')}
              </span>
            )}
          </div>

          <p className="text-sm text-foreground-muted">{t(`spaces.type.${space.type}`)}</p>

          {space.description !== null && <p className="text-sm">{space.description}</p>}

          {/*
            The schedule in words, including its absence. "Sem periodicidade
            definida" is a real answer and the reason no warning appears — a
            blank line here would leave somebody wondering whether the page had
            failed to load it.
          */}
          <p className="text-sm text-foreground-muted">
            {space.intervalHours === null
              ? t('spaces.noInterval')
              : t('spaces.everyHours', { hours: space.intervalHours })}
          </p>

          <p className="text-sm">
            {ago === null ? t('spaces.neverCleaned') : t('spaces.cleanedAgo', { ago })}
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setEditing(true)} className={BUTTON}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('common.edit')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={BUTTON}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('common.remove')}
            </button>
          </div>
        )}
      </div>

      {/*
        Icon and words, not colour alone. This is the one thing on the screen an
        operator is meant to act on, and it has to survive being read by somebody
        who cannot tell the red from the grey.
      */}
      {space.overdue && (
        <p className="flex items-center gap-2 rounded bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {t('spaces.overdueDetail')}
        </p>
      )}

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={t('spaces.edit')}
        description={space.name}
        closeLabel={t('common.close')}
      >
        <form action={dispatch} className="flex flex-col gap-4">
          <TextField
            name="name"
            label={t('spaces.name')}
            initial={space.name}
            required
            {...(state.fields?.name === undefined ? {} : { error: t(state.fields.name) })}
          />

          <SelectField
            name="type"
            label={t('spaces.typeLabel')}
            initial={space.type}
            options={SPACE_TYPES.map((type) => ({
              value: type,
              label: t(`spaces.type.${type}`),
            }))}
          />

          <TextField
            name="intervalHours"
            label={t('spaces.interval')}
            initial={space.intervalHours === null ? '' : String(space.intervalHours)}
            inputMode="numeric"
            hint={t('spaces.intervalHint')}
            {...(state.fields?.intervalHours === undefined
              ? {}
              : { error: t(state.fields.intervalHours) })}
          />

          <TextAreaField
            name="description"
            label={t('spaces.description')}
            initial={space.description ?? ''}
            rows={2}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={space.active}
              className="size-4"
            />
            {t('spaces.activeLabel')}
          </label>

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">{t(state.errorKey)}</p>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className={BUTTON}>
              {pending ? t('common.working') : t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>

      {/*
        The question is asked in the middle of the page, through the shared
        Dialog — never `window.confirm`, and never rendered in place of its own
        trigger. Deleting a space takes its cleaning history and its issues out
        of view with it, which is worth saying before it happens.
      */}
      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={t('spaces.delete')}
        description={space.name}
        closeLabel={t('common.close')}
      >
        <p className="text-sm">{t('spaces.confirmDelete')}</p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              void archiveSpace(space.id, space.facilityId).then((result) => {
                setDeleting(false);
                setConfirmingDelete(false);
                // Back to the site: the page this was on no longer exists.
                if (result.ok) router.push(`/dashboard/facilities/${space.facilityId}`);
              });
            }}
            className={BUTTON}
          >
            {deleting ? t('common.working') : t('common.remove')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className={BUTTON}
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
