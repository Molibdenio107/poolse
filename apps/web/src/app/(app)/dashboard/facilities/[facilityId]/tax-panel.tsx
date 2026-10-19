'use client';

import { useTranslations } from 'next-intl';
import { TextAreaField, TextField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { TaxSettings } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { savePaymentInstructionsAction, saveTaxNumberAction } from './club.actions';

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
 * *Como pagar* — POOLSE-86, 3.0b. The club's own words, shown verbatim under
 * every invoice reminder Poolse emails: an IBAN, an MB WAY number, office hours.
 * Empty, the reminder says to contact the club.
 */
export function PaymentInstructionsPanel({ settings }: { settings: TaxSettings }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(savePaymentInstructionsAction, INITIAL);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-medium">{t('clubData.paymentTitle')}</h2>
        <p className="text-sm text-foreground-muted">{t('clubData.paymentHint')}</p>
      </div>
      <form action={dispatch} className="flex flex-col gap-3">
        <TextAreaField
          name="paymentInstructions"
          label={t('clubData.paymentLabel')}
          initial={settings.paymentInstructions ?? ''}
          rows={4}
          maxLength={1000}
          placeholder={t('clubData.paymentPlaceholder')}
          error={state.fields?.['paymentInstructions'] === undefined ? undefined : t(state.fields['paymentInstructions'])}
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
