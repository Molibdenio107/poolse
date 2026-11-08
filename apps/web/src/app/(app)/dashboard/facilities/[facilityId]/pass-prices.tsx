'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Archive, Pencil, Plus } from 'lucide-react';
import { ARCHIVE_ICON, ARCHIVE_TRIGGER } from '@/lib/archive-trigger';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { centsToInput, formatCents, parseCents } from '@/lib/money';
import type { FeeCategory, PassPrice, PassProduct } from '@/lib/api';
import type { FormState } from '../../actions';
import { archivePriceAction, setPriceAction } from './passes.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const LINK =
  'inline-flex h-control items-center gap-1.5 rounded-sm px-2 text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

/**
 * A product's price per category — POOLSE-203, rule 5. The base price, one row
 * per category (its own price, or the base), and the combinations the club
 * typed. No grid of every mix: nothing combines unless somebody types it.
 *
 * Which price a person pays is `pass_price_for()` on the server; this table
 * only says what was typed.
 */
export function PassPriceTable({
  facilityId,
  product,
  categories,
}: {
  facilityId: string;
  product: PassProduct;
  categories: FeeCategory[];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [editing, setEditing] = useState<string | null>(null);
  const [combining, setCombining] = useState(false);
  const [removing, setRemoving] = useState<{ price: PassPrice; label: string } | null>(null);

  const ranked = [...categories].sort((a, b) => a.rank - b.rank);
  const single = (id: string): PassPrice | undefined =>
    product.prices.find((one) => one.categoryIds.length === 1 && one.categoryIds[0] === id);
  const combinations = product.prices.filter((one) => one.categoryIds.length > 1);

  if (ranked.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('passes.prices.noCategories')}</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-border p-3">
      <p className="text-sm text-foreground-muted">{t('passes.prices.hint')}</p>
      <dl className="flex flex-col divide-y divide-border">
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="font-medium">{t('passes.prices.base')}</dt>
          <dd className="tabular-nums">{formatCents(locale, product.amountCents)}</dd>
        </div>

        {ranked.map((category) => {
          const price = single(category.id);
          const key = `single:${category.id}`;
          return (
            <div key={category.id} className="flex flex-col gap-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt>{category.name}</dt>
                <dd className="flex items-center gap-1">
                  <span className={price === undefined ? 'text-sm text-foreground-muted' : 'tabular-nums'}>
                    {price === undefined ? t('passes.prices.atBase') : formatCents(locale, price.amountCents)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(editing === key ? null : key)}
                    aria-expanded={editing === key}
                    className={LINK}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    {price === undefined ? t('passes.prices.set') : t('passes.prices.change')}
                  </button>
                  {price !== undefined && (
                    <button
                      type="button"
                      onClick={() => setRemoving({ price, label: category.name })}
                      className={ARCHIVE_TRIGGER}
                    >
                      <Archive className={ARCHIVE_ICON} aria-hidden />
                      {t('passes.prices.remove')}
                    </button>
                  )}
                </dd>
              </div>
              {editing === key && (
                <PriceForm
                  facilityId={facilityId}
                  productId={product.id}
                  categoryIds={[category.id]}
                  initialCents={price?.amountCents ?? null}
                  onDone={() => setEditing(null)}
                />
              )}
            </div>
          );
        })}

        {combinations.map((price) => {
          const label = price.categoryNames.join(' + ');
          const key = `combo:${price.id}`;
          return (
            <div key={price.id} className="flex flex-col gap-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt>{label}</dt>
                <dd className="flex items-center gap-1">
                  <span className="tabular-nums">{formatCents(locale, price.amountCents)}</span>
                  <button
                    type="button"
                    onClick={() => setEditing(editing === key ? null : key)}
                    aria-expanded={editing === key}
                    className={LINK}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    {t('passes.prices.change')}
                  </button>
                  <button type="button" onClick={() => setRemoving({ price, label })} className={ARCHIVE_TRIGGER}>
                    <Archive className={ARCHIVE_ICON} aria-hidden />
                    {t('passes.prices.remove')}
                  </button>
                </dd>
              </div>
              {editing === key && (
                <PriceForm
                  facilityId={facilityId}
                  productId={product.id}
                  categoryIds={price.categoryIds}
                  initialCents={price.amountCents}
                  onDone={() => setEditing(null)}
                />
              )}
            </div>
          );
        })}
      </dl>

      {ranked.length > 1 &&
        (combining ? (
          <PriceForm
            facilityId={facilityId}
            productId={product.id}
            categoryIds={null}
            choices={ranked}
            initialCents={null}
            onDone={() => setCombining(false)}
          />
        ) : (
          <button type="button" onClick={() => setCombining(true)} className={`${LINK} self-start`}>
            <Plus className="size-3.5" aria-hidden />
            {t('passes.prices.addCombination')}
          </button>
        ))}

      {removing !== null && (
        <RemovePrice
          facilityId={facilityId}
          productId={product.id}
          price={removing.price}
          label={removing.label}
          onDone={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/**
 * One price. `categoryIds` fixed for a category's own row or an existing
 * combination; null with `choices` for a new combination, two or more ticked.
 */
function PriceForm({
  facilityId,
  productId,
  categoryIds,
  choices = [],
  initialCents,
  onDone,
}: {
  facilityId: string;
  productId: string;
  categoryIds: string[] | null;
  choices?: FeeCategory[];
  initialCents: number | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [amount, setAmount] = useState(initialCents === null ? '' : centsToInput(initialCents));
  const [ticked, setTicked] = useState<string[]>([]);
  const [state, submit, pending] = useSavedAction(async (previous: FormState, formData: FormData) => {
    const next = await setPriceAction(previous, formData);
    if (next.ok) onDone();
    return next;
  }, INITIAL);
  const cents = parseCents(amount);
  const fields = state.fields ?? {};
  const ids = categoryIds ?? ticked;

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="amountCents" value={cents === null ? '' : String(cents)} />
      {ids.map((id) => (
        <input key={id} type="hidden" name="categoryIds" value={id} />
      ))}

      {categoryIds === null && <input type="hidden" name="combination" value="1" />}
      {categoryIds === null && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('passes.prices.combinationOf')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {choices.map((category) => (
              <label key={category.id} className="inline-flex min-h-control items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ticked.includes(category.id)}
                  onChange={(event) =>
                    setTicked(
                      event.target.checked
                        ? [...ticked, category.id]
                        : ticked.filter((one) => one !== category.id),
                    )
                  }
                />
                {category.name}
              </label>
            ))}
          </div>
          {fields['categoryIds'] !== undefined && (
            <p role="alert" className="text-sm text-danger">
              {t(fields['categoryIds'])}
            </p>
          )}
        </fieldset>
      )}

      <TextField
        name="amountDisplay"
        label={t('passes.prices.amount')}
        initial={amount}
        onValueChange={setAmount}
        inputMode="decimal"
        error={fields['amountCents'] === undefined ? undefined : t(fields['amountCents'])}
        required
      />
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey, state.values ?? {})}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('common.save')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function RemovePrice({
  facilityId,
  productId,
  price,
  label,
  onDone,
}: {
  facilityId: string;
  productId: string;
  price: PassPrice;
  label: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(async (previous: FormState, formData: FormData) => {
    const next = await archivePriceAction(previous, formData);
    if (next.ok) onDone();
    return next;
  }, INITIAL);
  return (
    <Dialog open onClose={onDone} title={t('passes.prices.removeTitle')} closeLabel={t('common.cancel')}>
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="priceId" value={price.id} />
        <p className="text-sm">{t('passes.prices.removeAsk', { label })}</p>
        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('passes.prices.remove')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
