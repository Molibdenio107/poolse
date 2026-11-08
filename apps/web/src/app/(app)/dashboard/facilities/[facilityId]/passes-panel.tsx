'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Archive, Pencil, Plus, Ticket } from 'lucide-react';
import { ARCHIVE_TRIGGER, ARCHIVE_ICON } from '@/lib/archive-trigger';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';
import { centsToInput, formatCents, parseCents } from '@/lib/money';
import type { FeeCategory, PassKind, PassProduct } from '@/lib/api';
import { PassPriceTable } from './pass-prices';
import type { FormState } from '../../actions';
import { archiveProductAction, saveProductAction, saveStayAction } from './passes.actions';
import { Reveal } from '@/components/ui/reveal';

/**
 * Natação livre — what this site sells at reception (POOLSE-68).
 *
 * Under Preços because an entry is priced like a fee: gross, with the VAT
 * inside it. Three shapes on one list — a single entry, a pack of N, a pass
 * good for a number of days — and the form asks only what the chosen shape
 * needs. Editing a product reaches passes sold afterwards and none before: a
 * sold pass carries its own copy of what it was sold as.
 *
 * The default stay sits here too, because it is the one number that decides
 * how long somebody counts as in the water when nobody checks them out.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary font-semibold';

const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card';

export function PassesPanel({
  facilityId,
  products,
  stayMinutes,
  categories,
}: {
  facilityId: string;
  products: PassProduct[];
  stayMinutes: number;
  /** The club's categories, for the price table — POOLSE-203. */
  categories: FeeCategory[];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState<PassProduct | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);

  const shape = (product: PassProduct): string => {
    if (product.kind === 'single') return t('passes.shape.single');
    if (product.kind === 'pack') {
      return product.validityDays === null
        ? t('passes.shape.pack', { entries: product.entries ?? 0 })
        : t('passes.shape.packExpiring', {
            entries: product.entries ?? 0,
            days: product.validityDays,
          });
    }
    return t('passes.shape.period', { days: product.validityDays ?? 0 });
  };

  return (
    <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <Ticket aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('passes.title')}
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">{t('passes.hint')}</p>
        </div>
      </div>

      {products.length === 0 && <p className="text-sm text-foreground-muted">{t('passes.none')}</p>}

      {products.length > 0 && (
        <ul className="divide-y divide-border">
          {products.map((product) => (
            <li key={product.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-sm text-foreground-muted">
                    {shape(product)}
                    {' · '}
                    {formatCents(locale, product.amountCents)}
                    {' · '}
                    {product.vatExempt
                      ? t('passes.vatExemptShort')
                      : t('passes.vatShort', { rate: product.vatRate })}
                    {' · '}
                    {t('passes.sold', { count: product.soldCount })}
                    {product.shareable && ` · ${t('passes.shareableShort')}`}
                    {product.soldInApp && ` · ${t('passes.soldInAppShort')}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(editing === product.id ? null : product.id)}
                    aria-expanded={editing === product.id}
                    className={BUTTON_QUIET}
                  >
                    <Pencil aria-hidden className="size-4" />
                    <span className="sr-only">{t('passes.edit')}</span>
                  </button>
                  <button type="button" onClick={() => setDropping(product)} className={`${ARCHIVE_TRIGGER} w-control`}>
                    <Archive aria-hidden className={ARCHIVE_ICON} />
                    <span className="sr-only">{t('passes.archive')}</span>
                  </button>
                </div>
              </div>
              <Reveal open={editing === product.id}>
                <ProductForm
                  facilityId={facilityId}
                  product={product}
                  onDone={() => setEditing(null)}
                />
              </Reveal>
              {/* POOLSE-203: the price per category, and typed combinations. */}
              <button
                type="button"
                onClick={() => setPricing(pricing === product.id ? null : product.id)}
                aria-expanded={pricing === product.id}
                className="self-start text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {t('passes.prices.toggle', { count: product.prices.length })}
              </button>
              <Reveal open={pricing === product.id}>
                <PassPriceTable facilityId={facilityId} product={product} categories={categories} />
              </Reveal>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <ProductForm facilityId={facilityId} product={null} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <button type="button" onClick={() => setAdding(true)} className={BUTTON_QUIET}>
            <Plus aria-hidden className="size-4" />
            {t('passes.add')}
          </button>
        </div>
      )}

      <StayForm facilityId={facilityId} stayMinutes={stayMinutes} />

      {dropping !== null && (
        <DropProduct facilityId={facilityId} product={dropping} onDone={() => setDropping(null)} />
      )}
    </section>
  );
}

function ProductForm({
  facilityId,
  product,
  onDone,
}: {
  facilityId: string;
  product: PassProduct | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [kind, setKind] = useState<PassKind>(product?.kind ?? 'single');
  const [price, setPrice] = useState(product === null ? '' : centsToInput(product.amountCents));
  const [exempt, setExempt] = useState(product?.vatExempt ?? false);
  const [shareable, setShareable] = useState(product?.shareable ?? false);
  const [inApp, setInApp] = useState(product?.soldInApp ?? false);
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await saveProductAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );
  const cents = parseCents(price);
  const fields = state.fields ?? {};
  const error = (name: string): string | undefined =>
    fields[name] === undefined ? undefined : t(fields[name]);

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      {product !== null && <input type="hidden" name="productId" value={product.id} />}
      <input type="hidden" name="amountCents" value={cents === null ? '' : String(cents)} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          name="kind"
          label={t('passes.kind')}
          initial={kind}
          onValueChange={(value) => setKind(value as PassKind)}
          options={(['single', 'pack', 'period'] as const).map((value) => ({
            value,
            label: t(`passes.kindLabel.${value}`),
          }))}
          error={error('kind')}
          className="max-w-none"
        />
        <TextField
          name="name"
          label={t('passes.name')}
          hint={t('passes.nameHint')}
          initial={product?.name ?? ''}
          error={error('name')}
          required
          className="max-w-none"
        />
        {kind === 'pack' && (
          <TextField
            name="entries"
            inputMode="numeric"
            label={t('passes.entries')}
            initial={product?.entries === null || product === null ? '' : String(product.entries)}
            error={error('entries')}
            required
            className="max-w-none"
          />
        )}
        {kind !== 'single' && (
          <TextField
            name="validityDays"
            inputMode="numeric"
            label={t('passes.validityDays')}
            hint={kind === 'pack' ? t('passes.validityPackHint') : t('passes.validityPeriodHint')}
            initial={
              product?.validityDays === null || product === null ? '' : String(product.validityDays)
            }
            error={error('validityDays')}
            required={kind === 'period'}
            className="max-w-none"
          />
        )}
        <TextField
          name="priceDisplay"
          inputMode="decimal"
          label={t('passes.price')}
          hint={t('passes.priceHint')}
          initial={price}
          onValueChange={setPrice}
          error={error('amountCents')}
          required
          className="max-w-none"
        />
        {!exempt && (
          <TextField
            name="vatRate"
            inputMode="decimal"
            label={t('passes.vatRate')}
            initial={product === null ? '23' : String(product.vatRate)}
            error={error('vatRate')}
            className="max-w-none"
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="vatExempt"
          checked={exempt}
          onChange={(event) => setExempt(event.target.checked)}
          className="size-4"
        />
        {t('passes.vatExempt')}
      </label>

      {/* POOLSE-204: a family pack (not a single entry), and the phone. */}
      {kind !== 'single' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="shareable"
            checked={shareable}
            onChange={(event) => setShareable(event.target.checked)}
            className="size-4"
          />
          {t('passes.shareable')}
        </label>
      )}
      {kind !== 'single' && shareable && (
        <p className="text-sm text-foreground-muted">{t('passes.shareableHint')}</p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="soldInApp"
          checked={inApp}
          onChange={(event) => setInApp(event.target.checked)}
          className="size-4"
        />
        {t('passes.soldInApp')}
      </label>

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('passes.save')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('passes.cancel')}
        </button>
      </div>
    </form>
  );
}

function StayForm({
  facilityId,
  stayMinutes,
}: {
  facilityId: string;
  stayMinutes: number;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(saveStayAction, INITIAL);
  const fields = state.fields ?? {};

  return (
    <form action={submit} className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
      <input type="hidden" name="facilityId" value={facilityId} />
      <TextField
        name="minutes"
        inputMode="numeric"
        label={t('passes.stay')}
        hint={t('passes.stayHint')}
        initial={String(stayMinutes)}
        error={fields['minutes'] === undefined ? undefined : t(fields['minutes'])}
      />
      <div>
        <button type="submit" disabled={pending} className={BUTTON_QUIET}>
          {t('passes.save')}
        </button>
      </div>
    </form>
  );
}

function DropProduct({
  facilityId,
  product,
  onDone,
}: {
  facilityId: string;
  product: PassProduct;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await archiveProductAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('passes.archiveTitle')}
      description={product.name}
      closeLabel={t('passes.cancel')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="productId" value={product.id} />
        <p className="text-sm">{t('passes.archiveAsk', { count: product.soldCount })}</p>
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('passes.archive')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('passes.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
