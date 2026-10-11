'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useSavedAction } from '@/lib/saved';
import type { QualificationType } from '@/lib/api';
import type { FormState } from '../../../actions';
import {
  archiveTypeAction,
  saveTypeAction,
  saveWindowAction,
} from './qualifications.actions';

/**
 * The club's qualification types and its âmbar window — POOLSE-27, 7b.2.
 *
 * The two switches are the decision of 11-10-2026 made visible: *exigida para
 * dar aulas* turns a missing record into "em falta"; *bloquear novas
 * atribuições* is the opt-in block, and the form says plainly what it does and
 * that it never removes anybody from a turma they already have. A block needs
 * the type to be required — the database refuses the other combination, and
 * the checkbox is disabled rather than allowed to be refused.
 */

const BUTTON = 'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted disabled:opacity-60';
const PRIMARY = 'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60';

function TypeForm({
  organizationId,
  type,
}: {
  organizationId: string;
  type: QualificationType | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, saving] = useSavedAction<FormState, FormData>(
    saveTypeAction.bind(null, organizationId, type?.id ?? null),
    { ok: false },
  );
  const [required, setRequired] = useState(type?.requiredToTeach ?? false);
  const [blocks, setBlocks] = useState(type?.blocksAssignment ?? false);

  const error = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4">
        <TextField
          name="name"
          label={t('qualifications.field.name')}
          initial={type?.name ?? ''}
          maxLength={120}
          required
          error={error('name')}
        />
        <TextField
          name="defaultValidityMonths"
          label={t('qualifications.field.validity')}
          initial={type?.defaultValidityMonths?.toString() ?? ''}
          inputMode="numeric"
          hint={t('qualifications.field.validityHint')}
          error={error('defaultValidityMonths')}
        />
        <TextField
          name="amberDays"
          label={t('qualifications.field.typeWindow')}
          initial={type?.amberDays?.toString() ?? ''}
          inputMode="numeric"
          hint={t('qualifications.field.typeWindowHint')}
          error={error('amberDays')}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="requiredToTeach"
          checked={required}
          onChange={(event) => {
            setRequired(event.target.checked);
            if (!event.target.checked) setBlocks(false);
          }}
          className="mt-0.5"
        />
        <span className="flex flex-col">
          <span>{t('qualifications.field.required')}</span>
          <span className="text-foreground-muted">{t('qualifications.field.requiredHint')}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="blocksAssignment"
          checked={blocks}
          disabled={!required}
          onChange={(event) => setBlocks(event.target.checked)}
          className="mt-0.5"
        />
        <span className="flex flex-col">
          <span>{t('qualifications.field.blocks')}</span>
          <span className="text-foreground-muted">{t('qualifications.field.blocksHint')}</span>
          {error('blocksAssignment') !== undefined && (
            <span className="text-danger">{error('blocksAssignment')}</span>
          )}
        </span>
      </label>
      <div>
        <button type="submit" disabled={saving} className={PRIMARY}>
          {type === null ? t('qualifications.addType') : t('qualifications.save')}
        </button>
      </div>
    </form>
  );
}

export function TypesPanel({
  organizationId,
  types,
  amberDays,
}: {
  organizationId: string;
  types: QualificationType[];
  amberDays: number;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  // Archiving a type takes every record of it off every standing, so it asks.
  const [archiving, setArchiving] = useState<QualificationType | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [windowState, saveWindow, savingWindow] = useSavedAction<FormState, FormData>(
    saveWindowAction.bind(null, organizationId),
    { ok: false },
  );

  const archive = (typeId: string): void => {
    startTransition(async () => {
      const result = await archiveTypeAction(organizationId, typeId);
      setArchiving(null);
      if (result.ok) {
        toast.show('success', t('qualifications.archived'));
        router.refresh();
      } else {
        toast.show('danger', t((result.errorKey ?? 'qualifications.error.archiveFailed') as never));
      }
    });
  };

  return (
    <section className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{t('qualifications.types')}</h2>
        <p className="text-sm text-foreground-muted">{t('qualifications.typesHint')}</p>
      </div>

      <form action={saveWindow} className="flex flex-wrap items-end gap-3">
        <TextField
          name="amberDays"
          label={t('qualifications.field.window')}
          initial={String(amberDays)}
          inputMode="numeric"
          error={
            windowState.fields?.['amberDays'] === undefined
              ? undefined
              : t(windowState.fields['amberDays'] as never)
          }
        />
        <button type="submit" disabled={savingWindow} className={BUTTON}>
          {t('qualifications.save')}
        </button>
      </form>

      <ul className="flex flex-col divide-y divide-border">
        {types.map((type) => (
          <li key={type.id} className="flex flex-col gap-3 py-3 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-col">
                <span className="font-medium">{type.name}</span>
                <span className="text-sm text-foreground-muted">
                  {[
                    type.defaultValidityMonths === null
                      ? null
                      : t('qualifications.validityMonths', { months: type.defaultValidityMonths }),
                    type.requiredToTeach ? t('qualifications.requiredLabel') : null,
                    type.blocksAssignment ? t('qualifications.blocksLabel') : null,
                  ]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => setEditing(editing === type.id ? null : type.id)}
                >
                  {editing === type.id ? t('common.cancel') : t('qualifications.edit')}
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={pending}
                  onClick={() => setArchiving(type)}
                >
                  {t('qualifications.archive')}
                </button>
              </span>
            </div>
            {editing === type.id && <TypeForm organizationId={organizationId} type={type} />}
          </li>
        ))}
      </ul>

      <Dialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('qualifications.archiveTypeTitle', { name: archiving?.name ?? '' })}
        description={t('qualifications.archiveTypeHint')}
        closeLabel={t('common.close')}
        initialFocus={confirm}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setArchiving(null)} className={BUTTON}>
            {t('common.cancel')}
          </button>
          <button
            ref={confirm}
            type="button"
            disabled={pending}
            onClick={() => archiving !== null && archive(archiving.id)}
            className={PRIMARY}
          >
            {t('qualifications.archive')}
          </button>
        </div>
      </Dialog>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-medium">{t('qualifications.addType')}</h3>
        <TypeForm organizationId={organizationId} type={null} />
      </div>
    </section>
  );
}
