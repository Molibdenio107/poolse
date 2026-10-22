'use client';

import { useTranslations } from 'next-intl';
import { TextAreaField, TextField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { TaxSettings } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { formatIban, formatMbwayPhone } from '@poolse/rules';
import { savePaymentDetailsAction, savePaymentInstructionsAction, saveTaxNumberAction } from './club.actions';

/**
 * The club's own NIPC — POOLSE-62, second half.
 *
 * **With the club's settings, on the site's *Dados do clube* tab** — moved from
 * Faturação → Configuração on 13 October 2026 (Rui): the number is defined for
 * the club, and the documents read it from there. Signup deliberately does not ask — it stays
 * three fields and thirty seconds, and a tax number is the most intrusive
 * question you can put to somebody who has not decided yet.
 *
 * **It says out loud that the number is also checked against other clubs.** A
 * field that quietly does two things is a field somebody fills in wrongly, and
 * the refusal it can produce would otherwise arrive from nowhere.
 *
 * Controlled, like every field in this product: React 19 resets a form as soon
 * as a function action returns, including on a validation error, so an
 * uncontrolled input would wipe the number at the moment somebody is being asked
 * to correct it.
 */
const INITIAL: FormState = { ok: false };

export function TaxPanel({ settings }: { settings: TaxSettings }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(saveTaxNumberAction, INITIAL);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-medium">{t('settings.tax.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('settings.tax.hint')}</p>
      </div>

      <form action={dispatch} className="flex flex-col gap-3">
        <TextField
          name="taxNumber"
          label={t('settings.tax.number')}
          inputMode="numeric"
          initial={settings.taxNumber ?? ''}
          error={state.fields?.['taxNumber']}
          hint={t('settings.tax.numberHint')}
        />

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded bg-primary font-medium text-primary-foreground outline-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>
      </form>
    </section>
  );
}

/**
 * *Como pagar* — POOLSE-86, cards since POOLSE-94. Where families pay the club:
 * a bank transfer, MB WAY, and the club's own words for everything else. One
 * account for the whole club, not one per site (Rui, 22-10-2026). What is
 * filled in here is what families read on their fees and what every payment
 * reminder ends with.
 *
 * Transfer and MB WAY are one save, because they are one endpoint and one audit
 * entry; the free text keeps its own. An IBAN change is emailed to every owner,
 * and the card says so beside the field, so nobody learns it from the email.
 */
export function PaymentInstructionsPanel({ settings }: { settings: TaxSettings }): React.ReactElement {
  const t = useTranslations();
  const [details, dispatchDetails, savingDetails] = useSavedAction(savePaymentDetailsAction, INITIAL);
  const [state, dispatch, pending] = useSavedAction(savePaymentInstructionsAction, INITIAL);
  const fieldError = (fields: Record<string, string> | undefined, name: string): string | undefined =>
    fields?.[name] === undefined ? undefined : t(fields[name]);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-medium">{t('clubData.paymentTitle')}</h2>
        <p className="text-sm text-foreground-muted">{t('clubData.payment.hint')}</p>
      </div>

      <form action={dispatchDetails} className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="flex flex-col gap-3 rounded border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t('clubData.payment.transferTitle')}</legend>
            <TextField
              name="iban"
              label={t('clubData.payment.iban')}
              initial={settings.paymentIban === null ? '' : formatIban(settings.paymentIban)}
              autoComplete="off"
              placeholder="PT50 0000 0000 0000 0000 0000 0"
              maxLength={40}
              error={fieldError(details.fields, 'iban')}
              hint={t('clubData.payment.ibanHint')}
            />
            <TextField
              name="accountHolder"
              label={t('clubData.payment.holder')}
              initial={settings.paymentAccountHolder ?? ''}
              maxLength={70}
              error={fieldError(details.fields, 'accountHolder')}
              hint={t('clubData.payment.holderHint')}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-3 rounded border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t('clubData.payment.mbwayTitle')}</legend>
            <TextField
              name="mbwayPhone"
              label={t('clubData.payment.mbway')}
              initial={settings.paymentMbwayPhone === null ? '' : formatMbwayPhone(settings.paymentMbwayPhone)}
              inputMode="tel"
              autoComplete="off"
              placeholder="912 345 678"
              maxLength={20}
              error={fieldError(details.fields, 'mbwayPhone')}
              hint={t('clubData.payment.mbwayHint')}
            />
          </fieldset>
        </div>
        <button
          type="submit"
          disabled={savingDetails}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded bg-primary font-medium text-primary-foreground outline-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          {savingDetails ? t('common.working') : t('common.save')}
        </button>
      </form>

      <form action={dispatch} className="flex flex-col gap-3 rounded border border-border p-3">
        <TextAreaField
          name="paymentInstructions"
          label={t('clubData.payment.otherTitle')}
          initial={settings.paymentInstructions ?? ''}
          rows={3}
          maxLength={1000}
          placeholder={t('clubData.paymentPlaceholder')}
          hint={t('clubData.payment.otherHint')}
          error={fieldError(state.fields, 'paymentInstructions')}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded bg-primary font-medium text-primary-foreground outline-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>
      </form>
    </section>
  );
}
