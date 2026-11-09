'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import { SelectField } from '@/components/ui/field';
import { formatCents } from '@/lib/money';
import type { AppPasses } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { newUuid } from '@/lib/uuid';
import { buyPassAction } from './buy.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Comprar um pack* — POOLSE-204, rule 5. The price shown is the server's
 * (`pass_price_for`), and the purchase prices it again. One idempotency key per
 * form, so a double tap is one document; a new key after each purchase.
 */
export function BuyForm({ forSale, people }: Pick<AppPasses, 'forSale' | 'people'>): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [productId, setProductId] = useState(forSale[0]?.id ?? '');
  const [person, setPerson] = useState('self');
  const [key, setKey] = useState(() => newUuid());
  const product = forSale.find((one) => one.id === productId);
  // A family pack is the payer's own: nobody else to choose.
  const choices = product?.shareable === true ? people.filter((one) => one.self) : people;
  const who = choices.some((one) => one.key === person) ? person : 'self';
  const price = product?.prices.find((one) => one.personKey === who);
  const [state, submit, pending] = useSavedAction(async (previous: FormState, formData: FormData) => {
    const next = await buyPassAction(previous, formData);
    if (next.ok) setKey(newUuid());
    return next;
  }, INITIAL);
  const fields = state.fields ?? {};

  return (
    <form action={submit} className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
      <h2 className="text-base font-semibold">{t('app.passes.buyTitle')}</h2>
      <input type="hidden" name="purchaseKey" value={key} />
      <input type="hidden" name="person" value={who} />
      <SelectField
        name="productId"
        label={t('app.passes.product')}
        initial={productId}
        onValueChange={setProductId}
        options={forSale.map((one) => ({ value: one.id, label: `${one.name} · ${one.facilityName}` }))}
        error={fields['productId'] === undefined ? undefined : t(fields['productId'])}
      />
      {choices.length > 1 && (
        <SelectField
          name="personChoice"
          label={t('app.passes.forWhom')}
          initial={who}
          onValueChange={setPerson}
          options={choices.map((one) => ({ value: one.key, label: one.self ? t('app.passes.forMe') : one.name }))}
          error={fields['studentId'] === undefined ? undefined : t(fields['studentId'])}
        />
      )}
      {product?.shareable === true && <p className="text-sm text-foreground-muted">{t('app.passes.familyHint')}</p>}
      {price !== undefined && (
        <p className="text-base font-semibold">
          {price.categoryNames === null
            ? formatCents(locale, price.amountCents)
            : t('app.passes.priceFor', { amount: formatCents(locale, price.amountCents), categories: price.categoryNames })}
        </p>
      )}
      <p className="text-sm text-foreground-muted">{t('app.passes.payFirst')}</p>
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey, state.values ?? {})}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] items-center justify-center rounded-sm bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('app.passes.buy')}
      </button>
    </form>
  );
}
