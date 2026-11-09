'use client';

import { useTranslations } from 'next-intl';
import { TextField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { saveBillingEmailAction } from './billing-email.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Email de faturação* — POOLSE-209 (Rui, 09-11-2026). Where Poolse's own
 * invoices and receipts for the subscription go: Stripe's customer email, often
 * an accountant's. Owner only, as this whole screen is. Never family mail: that
 * is *Dados do clube*'s reply email. Until set, the owner's address is used, and
 * the field says so.
 */
export function BillingEmailForm({
  billingEmail,
  fallback,
}: {
  billingEmail: string | null;
  fallback: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(saveBillingEmailAction, INITIAL);

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <div>
        <h2 className="text-sm font-medium">{t('subscription.billingEmail.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('subscription.billingEmail.hint')}</p>
      </div>
      <form action={dispatch} className="flex flex-col gap-3">
        <TextField
          name="billingEmail"
          type="email"
          label={t('subscription.billingEmail.label')}
          initial={billingEmail ?? fallback ?? ''}
          autoComplete="email"
          maxLength={254}
          error={state.fields?.['billingEmail'] === undefined ? undefined : t(state.fields['billingEmail'])}
          hint={
            billingEmail === null && fallback !== null
              ? t('subscription.billingEmail.usingOwner', { email: fallback })
              : undefined
          }
        />
        {state.errorKey !== undefined && (
          <p className="text-sm text-warning" role="status">
            {t(state.errorKey)}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded-sm bg-primary font-semibold text-primary-foreground outline-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>
      </form>
    </section>
  );
}
