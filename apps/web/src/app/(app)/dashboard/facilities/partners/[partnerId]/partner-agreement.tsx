'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { BillingModel, PartnerAgreement } from '@/lib/api';
import { DocumentUpload } from '@/components/document-upload';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { saveAgreementAction } from '../../[facilityId]/partners.actions';

/**
 * What the partner pays — POOLSE-47, criteria 5 and 6.
 *
 * **The price is a unit price, not an amount.** Everywhere else in Poolse money
 * is integer cents; here it is `numeric(12,6)`, and the reason is on the screen
 * as well as in the schema: a lane-hour at €14,375 is real, and rounding it to
 * €14,38 before multiplying it by six lanes and thirty weeks puts €1,35 a week
 * into a figure whose whole job is to be the number the club invoices. So the
 * box accepts three decimal places, the value never becomes a JavaScript number,
 * and it is displayed exactly as it was stored.
 *
 * **An empty IVA box is isento, and says so.** Null is a claim — "this is
 * outside VAT" — and it is a different claim from 0%. The read view prints the
 * word rather than leaving the row blank, because a blank reads as unfinished.
 *
 * **A new agreement is a new row.** Recording next year's price does not
 * overwrite this year's, so last season's invoices still have something that
 * explains them.
 */

const INITIAL: FormState = { ok: false };

const BILLING_MODELS: readonly BillingModel[] = [
  'por_hora_pista',
  'por_bloco',
  'por_participante',
  'mensal_fixo',
];

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'h-control rounded border border-border px-4 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * A decimal string, shown in the reader's locale, without arithmetic.
 *
 * `Intl.NumberFormat` takes a string for exactly this reason: it formats the
 * digits it is given rather than a float it had to parse first. '14.375' becomes
 * "14,375" in pt-PT with nothing lost on the way.
 */
function formatDecimal(locale: string, value: string, maxDigits: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits,
  }).format(Number(value));
}

/** '0.2300' as it appears on a contract: 23. */
function vatPercent(locale: string, fraction: string): string {
  return formatDecimal(locale, String(Number(fraction) * 100), 2);
}

export function PartnerAgreementPanel({
  partnerId,
  agreement,
  canManage,
}: {
  partnerId: string;
  agreement: PartnerAgreement | null;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [state, save, pending] = useSavedAction(saveAgreementAction, INITIAL);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('partners.agreement')}
          </h2>
          {/*
            Said plainly, because it is the boundary the ticket drew: this
            records what was agreed and computes what is contracted. It does not
            invoice. A partnership bills an organisation against a contract; the
            mensalidades engine bills a family a monthly plan against enrolments,
            and forcing both through one engine would make the student path carry
            a concept it does not have.
          */}
          <p className="mt-1 text-sm text-foreground-muted">{t('partners.agreementNotBilling')}</p>
        </div>

        {canManage && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={BUTTON_QUIET}>
            {agreement === null ? t('partners.recordAgreement') : t('partners.newAgreement')}
          </button>
        )}
      </div>

      {editing && canManage && (
        <form action={save} className="flex flex-col gap-4">
          <input type="hidden" name="partnerId" value={partnerId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="billingModel"
              label={t('partners.billingModel')}
              initial={agreement?.billingModel ?? 'por_hora_pista'}
              options={BILLING_MODELS.map((model) => ({
                value: model,
                label: t(`partners.billing.${model}`),
              }))}
            />

            <TextField
              name="unitPrice"
              label={t('partners.unitPrice')}
              initial={agreement?.unitPrice ?? ''}
              required
              hint={t('partners.unitPriceHint')}
              error={state.fields?.['unitPrice'] ? t(state.fields['unitPrice']) : undefined}
            />

            <TextField
              name="vatRate"
              label={t('partners.vatRate')}
              initial={agreement?.vatRate === null || agreement === null
                ? ''
                : vatPercent(locale, agreement.vatRate)}
              hint={t('partners.vatRateHint')}
              error={state.fields?.['vatRate'] ? t(state.fields['vatRate']) : undefined}
            />

            <TextField
              name="paymentPeriod"
              label={t('partners.paymentPeriod')}
              initial={agreement?.paymentPeriod ?? ''}
              maxLength={40}
              hint={t('partners.paymentPeriodHint')}
            />

            <TextField
              name="startDate"
              label={t('partners.startDate')}
              type="date"
              initial={agreement?.startDate ?? ''}
              required
              error={state.fields?.['startDate'] ? t(state.fields['startDate']) : undefined}
            />

            <TextField
              name="endDate"
              label={t('partners.endDate')}
              type="date"
              initial={agreement?.endDate ?? ''}
              hint={t('partners.endDateHint')}
            />
          </div>

          <TextAreaField
            name="notes"
            label={t('partners.notes')}
            initial={agreement?.notes ?? ''}
            rows={3}
            maxLength={2000}
          />

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">{t(state.errorKey)}</p>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={BUTTON}>
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BUTTON_QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {!editing &&
        (agreement === null ? (
          <p className="text-sm text-foreground-muted">{t('partners.noAgreement')}</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-foreground-muted">{t('partners.billingModel')}</dt>
              <dd className="mt-0.5">{t(`partners.billing.${agreement.billingModel}`)}</dd>
            </div>

            <div>
              <dt className="text-sm text-foreground-muted">{t('partners.unitPrice')}</dt>
              <dd className="mt-0.5 tabular-nums">
                {t('partners.unitPriceValue', {
                  // Three decimal places kept, because that is the point of the
                  // column. €14,375 shown as €14,38 would be the screen quietly
                  // disagreeing with the contract.
                  price: formatDecimal(locale, agreement.unitPrice, 3),
                  unit: t(`partners.unitOf.${agreement.billingModel}`),
                })}
              </dd>
            </div>

            <div>
              <dt className="text-sm text-foreground-muted">{t('partners.vatRate')}</dt>
              <dd className="mt-0.5">
                {agreement.vatRate === null
                  ? t('partners.exempt')
                  : `${vatPercent(locale, agreement.vatRate)}%`}
              </dd>
            </div>

            <div>
              <dt className="text-sm text-foreground-muted">{t('partners.paymentPeriod')}</dt>
              <dd className="mt-0.5">{agreement.paymentPeriod ?? '—'}</dd>
            </div>

            <div>
              <dt className="text-sm text-foreground-muted">{t('partners.term')}</dt>
              <dd className="mt-0.5">
                {agreement.endDate === null
                  ? t('partners.openEnded', { start: agreement.startDate })
                  : t('partners.termRange', {
                      start: agreement.startDate,
                      end: agreement.endDate,
                    })}
              </dd>
            </div>

            {agreement.notes !== null && (
              <div className="sm:col-span-2">
                <dt className="text-sm text-foreground-muted">{t('partners.notes')}</dt>
                <dd className="mt-0.5 whitespace-pre-line">{agreement.notes}</dd>
              </div>
            )}
          </dl>
        ))}

      {/*
        The signed contract — criterion 6.

        Present, styled and visibly disabled with the reason named, exactly as
        the logo, the pool photo and the student photograph are. One storage
        decision unblocks all four; until then a control that opened a picker and
        then lost the file would be worse than one that says why it cannot.
      */}
      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-medium">{t('partners.contract')}</h3>
        <DocumentUpload
          label={t('partners.uploadContract')}
          reason={t('students.photoNoStorage')}
          purpose={t('partners.contractPurpose')}
        />
      </div>
    </section>
  );
}
