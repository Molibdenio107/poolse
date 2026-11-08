'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Archive, Plus, Tag } from 'lucide-react';
import { ARCHIVE_ICON, ARCHIVE_TRIGGER } from '@/lib/archive-trigger';
import { formatDate } from '@/lib/date-format';
import { today } from '@/lib/dates';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';
import type { PersonCategory } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import {
  addPersonCategoryAction,
  loadPersonCategories,
  removePersonCategoryAction,
  renewPersonCategoryAction,
  type PersonCategoriesLoad,
  type PersonRef,
} from '@/lib/person-categories.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const LINK =
  'inline-flex h-control items-center gap-1.5 self-start rounded-sm px-2 text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

/**
 * *Categorias* — POOLSE-202. A person's categories (*Sénior*, *Sócio*,
 * *Munícipe*), each ticked by the office after seeing proof: who checked it,
 * when, and until when. Add, renew with new dates, or remove (an archive that
 * asks first). The state of each row (valid, expiring, expired) is the API's,
 * from SQL; this card only words it.
 *
 * It loads itself, so the student record and Receção's person panel use the
 * same card without either page fetching for it.
 */
export function PersonCategoriesCard({
  person,
  className = '',
}: {
  person: PersonRef;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  const key = 'studentId' in person ? person.studentId : person.membershipId;
  const [load, setLoad] = useState<PersonCategoriesLoad | 'failed' | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    const answer = await loadPersonCategories(person);
    setLoad(answer.state === 'ok' ? answer.data : 'failed');
    // `person` is a fresh object each render; its id is what matters.
  }, [key]);

  useEffect(() => {
    setLoad(null);
    void reload();
  }, [reload]);

  return (
    <section
      aria-labelledby={`person-categories-${key}`}
      className={`flex flex-col gap-3 rounded bg-surface p-5 shadow-card ${className}`}
    >
      <h2 id={`person-categories-${key}`} className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-foreground-muted">
        <Tag className="size-4" aria-hidden />
        {t('personCategories.title')}
      </h2>

      {load === null && <p className="text-sm text-foreground-muted">{t('personCategories.loading')}</p>}
      {load === 'failed' && <p className="text-sm text-danger">{t('personCategories.loadFailed')}</p>}

      {load !== null && load !== 'failed' && (
        <>
          {load.categories.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('personCategories.none')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {load.categories.map((row) => (
                <Row key={row.id} row={row} onChanged={reload} />
              ))}
            </ul>
          )}

          {adding ? (
            <AddForm
              person={person}
              options={load.options.filter((one) => !load.categories.some((held) => held.categoryId === one.id))}
              onDone={() => setAdding(false)}
              onSaved={reload}
            />
          ) : load.options.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('personCategories.noClubCategories')}</p>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={LINK}>
              <Plus className="size-3.5" aria-hidden />
              {t('personCategories.add')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** The row's state in words, never by colour alone. */
export function categoryStatusText(
  t: ReturnType<typeof useTranslations>,
  row: Pick<PersonCategory, 'status' | 'validUntil'>,
): string {
  if (row.validUntil === null) return t('personCategories.noExpiry');
  const date = formatDate(row.validUntil);
  if (row.status === 'expired') return t('personCategories.expiredOn', { date });
  if (row.status === 'expiring') return t('personCategories.expiresOn', { date });
  return t('personCategories.validUntil', { date });
}

function Row({ row, onChanged }: { row: PersonCategory; onChanged: () => Promise<void> }): React.ReactElement {
  const t = useTranslations();
  const [renewing, setRenewing] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{row.name}</span>
          <span
            className={
              row.status === 'live'
                ? 'text-sm text-foreground-muted'
                : 'flex items-center gap-1.5 text-sm font-medium text-foreground'
            }
          >
            {row.status !== 'live' && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />}
            {categoryStatusText(t, row)}
          </span>
          <span className="text-sm text-foreground-muted">
            {row.proofSeenByName === null
              ? t('personCategories.proofSeen', { date: formatDate(row.proofSeenOn) })
              : t('personCategories.proofSeenBy', { date: formatDate(row.proofSeenOn), name: row.proofSeenByName })}
            {row.notes !== null && ` · ${row.notes}`}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => setRenewing(!renewing)} className={LINK} aria-expanded={renewing}>
            {t('personCategories.renew')}
          </button>
          <button type="button" onClick={() => setRemoving(true)} className={ARCHIVE_TRIGGER}>
            <Archive className={ARCHIVE_ICON} aria-hidden />
            {t('personCategories.remove')}
          </button>
        </span>
      </div>

      {renewing && (
        <ProofForm
          action={renewPersonCategoryAction}
          hidden={{ personCategoryId: row.id }}
          submitLabel={t('personCategories.saveRenewal')}
          onDone={() => setRenewing(false)}
          onSaved={onChanged}
        />
      )}

      {removing && <RemoveDialog row={row} onDone={() => setRemoving(false)} onSaved={onChanged} />}
    </li>
  );
}

function AddForm({
  person,
  options,
  onDone,
  onSaved,
}: {
  person: PersonRef;
  options: { id: string; name: string }[];
  onDone: () => void;
  onSaved: () => Promise<void>;
}): React.ReactElement {
  const t = useTranslations();
  if (options.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-foreground-muted">{t('personCategories.allHeld')}</p>
        <button type="button" onClick={onDone} className={`${BUTTON_QUIET} self-start`}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }
  return (
    <ProofForm
      action={addPersonCategoryAction}
      hidden={'studentId' in person ? { studentId: person.studentId } : { membershipId: person.membershipId }}
      categories={options}
      submitLabel={t('personCategories.add')}
      onDone={onDone}
      onSaved={onSaved}
    />
  );
}

/** Proof seen on, valid until and what was seen — shared by add and renew. */
function ProofForm({
  action,
  hidden,
  categories,
  submitLabel,
  onDone,
  onSaved,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  categories?: { id: string; name: string }[];
  submitLabel: string;
  onDone: () => void;
  onSaved: () => Promise<void>;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(async (previous: FormState, formData: FormData) => {
    const next = await action(previous, formData);
    if (next.ok) {
      await onSaved();
      onDone();
    }
    return next;
  }, INITIAL);
  const fields = state.fields ?? {};
  const error = (name: string): string | undefined => (fields[name] === undefined ? undefined : t(fields[name]));

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {categories !== undefined && (
          <SelectField
            name="categoryId"
            label={t('personCategories.category')}
            options={categories.map((one) => ({ value: one.id, label: one.name }))}
            initial={categories[0]?.id ?? ''}
            error={error('categoryId')}
            required
            className="max-w-none"
          />
        )}
        <TextField
          name="proofSeenOn"
          type="date"
          label={t('personCategories.proofSeenOn')}
          initial={today()}
          error={error('proofSeenOn')}
          required
          className="max-w-none"
        />
        <TextField
          name="validUntil"
          type="date"
          label={t('personCategories.validUntilLabel')}
          hint={t('personCategories.validUntilHint')}
          error={error('validUntil')}
          className="max-w-none"
        />
      </div>
      <TextField
        name="notes"
        label={t('personCategories.notes')}
        hint={t('personCategories.notesHint')}
        maxLength={200}
        error={error('notes')}
        className="max-w-none"
      />
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey, state.values ?? {})}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {submitLabel}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function RemoveDialog({
  row,
  onDone,
  onSaved,
}: {
  row: PersonCategory;
  onDone: () => void;
  onSaved: () => Promise<void>;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(async (previous: FormState, formData: FormData) => {
    const next = await removePersonCategoryAction(previous, formData);
    if (next.ok) {
      await onSaved();
      onDone();
    }
    return next;
  }, INITIAL);

  return (
    <Dialog open onClose={onDone} title={t('personCategories.removeTitle')} closeLabel={t('common.cancel')}>
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="personCategoryId" value={row.id} />
        <p className="text-sm">{t('personCategories.removeAsk', { name: row.name })}</p>
        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('personCategories.remove')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
