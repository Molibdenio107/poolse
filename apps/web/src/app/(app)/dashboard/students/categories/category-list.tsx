'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import type { FeeCategory } from '@/lib/api';
import type { FormState } from '../../actions';
import { archiveCategoryAction, saveCategoryAction } from './categories.actions';

/**
 * The list a club maintains — POOLSE-23 AC4.
 *
 * Deliberately plain. A category is a name and a place in an order, and the
 * temptation this screen has to resist is a percentage column: what a category
 * is *worth* belongs to the pricing engine, and a number here would be a
 * discount nobody can report on and nobody can change in one place.
 *
 * Each row says how many turmas and enrolments use it, because that is what
 * makes archiving a decision rather than a click — and it is the same pair the
 * refusal comes back with when somebody tries anyway.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function CategoryList({
  categories,
  canManage,
}: {
  categories: FeeCategory[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState<FeeCategory | null>(null);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      {categories.length === 0 && (
        <p className="text-sm text-foreground-muted">{t('categories.none')}</p>
      )}

      {categories.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {categories.map((category) => (
            <li key={category.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-medium">{category.name}</span>
                <span className="flex items-center gap-3">
                  {/*
                    Visible text, not a tooltip: this is the number that decides
                    whether archiving is safe, and it is the same pair the
                    refusal reports if somebody tries it anyway.
                  */}
                  <span className="text-sm text-foreground-muted">
                    {t('categories.usedBy', {
                      groups: category.usedByGroups,
                      enrollments: category.usedByEnrollments,
                    })}
                  </span>
                  {canManage && (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(editing === category.id ? null : category.id)}
                        aria-expanded={editing === category.id}
                        aria-label={t('categories.rename')}
                        className={BUTTON_QUIET}
                      >
                        <Pencil aria-hidden className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDropping(category)}
                        aria-label={t('categories.archive')}
                        className={BUTTON_QUIET}
                      >
                        <Trash2 aria-hidden className="size-3.5" />
                      </button>
                    </span>
                  )}
                </span>
              </div>

              {canManage && editing === category.id && (
                <CategoryForm category={category} onDone={() => setEditing(null)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (adding ? (
          <CategoryForm category={null} onDone={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="self-start text-sm text-primary hover:underline"
          >
            <Plus aria-hidden className="mr-1 inline size-3.5" />
            {t('categories.add')}
          </button>
        ))}

      {dropping !== null && (
        <DropCategory category={dropping} onDone={() => setDropping(null)} />
      )}
    </section>
  );
}

function CategoryForm({
  category,
  onDone,
}: {
  category: FeeCategory | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await saveCategoryAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  const fields = state.fields ?? {};

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      {category !== null && <input type="hidden" name="categoryId" value={category.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="name"
          label={t('categories.name')}
          initial={category?.name ?? ''}
          error={fields['name'] === undefined ? undefined : t(fields['name'])}
          required
          className="max-w-none"
        />
        <TextField
          name="sortOrder"
          label={t('categories.sortOrder')}
          initial={String(category?.sortOrder ?? 0)}
          inputMode="numeric"
          hint={t('categories.sortOrderHint')}
          className="max-w-none"
        />
      </div>

      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey, state.values ?? {})}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('categories.save')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('categories.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * Archiving, asked in a dialog rather than in place.
 *
 * `components/ui/dialog.tsx` by the standing convention — it portals to the
 * body, closes on Escape and on the backdrop, and gives focus back.
 *
 * The refusal arrives here as two numbers and is said with them. "Não é possível
 * arquivar" alone leaves an operator with nothing to do next; "ainda é usada por
 * 2 turmas e 5 inscrições" tells them exactly where to go.
 */
function DropCategory({
  category,
  onDone,
}: {
  category: FeeCategory;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await archiveCategoryAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('categories.archive')}
      closeLabel={t('categories.cancel')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="categoryId" value={category.id} />

        <p className="text-sm">{t('categories.archiveAsk', { name: category.name })}</p>

        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('categories.archive')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('categories.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
