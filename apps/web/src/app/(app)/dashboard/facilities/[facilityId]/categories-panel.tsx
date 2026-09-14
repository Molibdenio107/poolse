'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL, TextField } from '@/components/ui/field';
import { centsToInput, formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { FeeCategory } from '@/lib/api';
import type { FormState } from '../../actions';
import { archiveCategoryAction, saveCategoryAction } from './categories.actions';

/**
 * Categorias de preço — round 19, and the other half of the price list.
 *
 * A price says what a level costs; a category says why one person pays less than
 * the person in the next lane. POOLSE-23 built it as a label and said so twice —
 * "a reference, never a percentage" — and a year proved the opposite: nothing
 * consulted the label, so the concession was typed into a free-text reason once
 * per family. One decision with forty authors. The category now carries the
 * figure, and a fee line snapshots it at the moment it is agreed.
 *
 * **On the site's page, beside the prices it modifies.** It used to live under
 * Alunos beside Níveis, which is where a club sets up lists — but the question
 * "what does a senior pay" is asked while looking at what anybody pays, and two
 * screens away is where a concession goes to be forgotten.
 *
 * **The list is the club's, and the panel says so.** The endpoint is
 * organization-scoped: the same four categories appear on every site, and
 * editing one here changes it everywhere. That is the decision, not an accident
 * — a "Sénior" meaning one thing at one pool and another at the next is a
 * concession nobody could report on. The line of text under the heading is what
 * stops the panel implying otherwise.
 *
 * **Editing a category never re-prices anybody.** Every line already agreed
 * keeps the figure it snapshotted; the new value applies to lines agreed from
 * here on. Said on the screen, because it is the one thing an operator would
 * reasonably assume the other way round.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Which of the three answers a category is currently on. */
type DiscountKind = 'none' | 'percent' | 'amount';

function kindOf(category: FeeCategory | null): DiscountKind {
  if (category?.discountPercent !== null && category?.discountPercent !== undefined) return 'percent';
  if (category?.discountCents !== null && category?.discountCents !== undefined) return 'amount';
  return 'none';
}

/**
 * What a category takes off, as a sentence.
 *
 * Three states and each is a different fact. A category with no value is a
 * label, which is a legitimate thing to keep — and it must not read as 0 %,
 * which would be a decision somebody took. A reader who may not see amounts gets
 * a fourth sentence rather than a blank, because a blank would read as the
 * first.
 */
function Worth({
  category,
  canSeeValues,
}: {
  category: FeeCategory;
  canSeeValues: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  if (!canSeeValues) {
    return <span className="text-sm text-foreground-muted">{t('categories.valueHidden')}</span>;
  }

  if (category.discountPercent !== null) {
    return (
      <span className="rounded bg-primary/10 px-2 py-0.5 text-sm tabular-nums text-primary">
        {t('categories.offPercent', { discount: category.discountPercent })}
      </span>
    );
  }

  if (category.discountCents !== null) {
    return (
      <span className="rounded bg-primary/10 px-2 py-0.5 text-sm tabular-nums text-primary">
        {t('categories.offAmount', { amount: formatCents(locale, category.discountCents) })}
      </span>
    );
  }

  return <span className="text-sm text-foreground-muted">{t('categories.labelOnly')}</span>;
}

export function CategoriesPanel({
  facilityId,
  categories,
  canManage,
  canSeeValues,
}: {
  facilityId: string;
  categories: FeeCategory[];
  canManage: boolean;
  canSeeValues: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState<FeeCategory | null>(null);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          <Tag aria-hidden className="size-4" />
          {t('categories.title')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('categories.hint')}</p>
      </div>

      {/*
        Two sentences the panel cannot do without, as visible text rather than a
        tooltip: this list is shared by every site, and changing a value does not
        move a price anybody has already agreed.
      */}
      <p className="text-sm text-foreground-muted">{t('categories.panelHint')}</p>

      {categories.length === 0 && (
        <p className="text-sm text-foreground-muted">{t('categories.none')}</p>
      )}

      {categories.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {categories.map((category) => (
            <li key={category.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{category.name}</span>
                  <Worth category={category} canSeeValues={canSeeValues} />
                </span>
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
                <CategoryForm
                  facilityId={facilityId}
                  category={category}
                  onDone={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (adding ? (
          <CategoryForm facilityId={facilityId} category={null} onDone={() => setAdding(false)} />
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

      {/*
        What a category is *for*, said on the page rather than assumed.

        The precedence — the turma, beaten by the enrolment — is the whole model
        and it is two sentences. It used to sit on the categories page under
        Alunos; it travels with the list.
      */}
      <section className="rounded border border-border p-4">
        <h3 className="text-sm font-medium">{t('categories.howTitle')}</h3>
        <p className="mt-2 text-sm text-foreground-muted">{t('categories.howBody')}</p>
      </section>

      {dropping !== null && (
        <DropCategory
          facilityId={facilityId}
          category={dropping}
          onDone={() => setDropping(null)}
        />
      )}
    </section>
  );
}

/**
 * One category: a name, a place in an order, and what it is worth.
 *
 * The value is **one control with three answers** — none, a percentage, a fixed
 * amount — rather than two boxes and a rule about not filling both in. The
 * database says the same thing with a CHECK; a form that could express the
 * refused state would only be a way to discover it.
 */
function CategoryForm({
  facilityId,
  category,
  onDone,
}: {
  facilityId: string;
  category: FeeCategory | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [kind, setKind] = useState<DiscountKind>(kindOf(category));
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
      <input type="hidden" name="facilityId" value={facilityId} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          name="name"
          label={t('categories.name')}
          initial={category?.name ?? ''}
          error={fields['name'] === undefined ? undefined : t(fields['name'])}
          required
          className="max-w-none"
        />

        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`cat-kind-${category?.id ?? 'new'}`} className={FIELD_LABEL}>
            {t('categories.discountKind')}
          </label>
          <select
            id={`cat-kind-${category?.id ?? 'new'}`}
            name="discountKind"
            value={kind}
            onChange={(event) => setKind(event.target.value as DiscountKind)}
            className={CONTROL_LINE}
          >
            <option value="none">{t('categories.labelOnly')}</option>
            <option value="percent">{t('categories.kindPercent')}</option>
            <option value="amount">{t('categories.kindAmount')}</option>
          </select>
        </div>

        {kind === 'none' ? (
          // Nothing to type, and the reason it is empty said rather than left
          // blank: a category with no value is a decision, not an oversight.
          <p className="self-end text-sm text-foreground-muted sm:col-span-2">
            {t('categories.labelOnlyHint')}
          </p>
        ) : (
          <div className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor={`cat-value-${category?.id ?? 'new'}`} className={FIELD_LABEL}>
              {kind === 'percent' ? t('categories.percentLabel') : t('categories.amountLabel')}
            </label>
            <input
              id={`cat-value-${category?.id ?? 'new'}`}
              name="discountValue"
              inputMode="decimal"
              /*
                Re-seeded on the kind, so switching from 20 % to a fixed amount
                does not leave "20" in a box that now means twenty euros.
              */
              key={kind}
              defaultValue={
                kind === 'percent'
                  ? category?.discountPercent === null || category?.discountPercent === undefined
                    ? ''
                    : String(category.discountPercent)
                  : category?.discountCents === null || category?.discountCents === undefined
                    ? ''
                    : centsToInput(category.discountCents)
              }
              className={CONTROL_LINE}
            />
            {fields['discountValue'] !== undefined && (
              <p role="alert" className="text-sm text-danger">
                {t(fields['discountValue'])}
              </p>
            )}
          </div>
        )}

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
  facilityId,
  category,
  onDone,
}: {
  facilityId: string;
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
        <input type="hidden" name="facilityId" value={facilityId} />

        <p className="text-sm">{t('categories.archiveAsk', { name: category.name })}</p>
        {/* Lines already agreed keep what they were agreed at — the one thing
            somebody archiving a concession would reasonably worry about. */}
        <p className="text-sm text-foreground-muted">{t('categories.archiveKeepsLines')}</p>

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
