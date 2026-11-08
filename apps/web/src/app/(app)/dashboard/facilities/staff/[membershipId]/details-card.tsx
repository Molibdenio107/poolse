'use client';

import { useEffect, useState } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { SelectField, TextField } from '@/components/ui/field';
import { countryOptions } from '@/lib/countries';
import { useSavedAction } from '@/lib/saved';
import type { StaffDetails } from '@/lib/api';
import type { FormState } from '../../../actions';
import { saveDetailsAction } from './details.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Dados pessoais* — POOLSE-149 slice A. Rendered only when the API answered,
 * which is the owner, an admin or the person themself.
 *
 * The NIF and NISS are the club's to set: the person reads theirs here and the
 * fields are not offered to them, so the form never sends what the API would
 * refuse. Everything else the person keeps up to date themself.
 */
export function DetailsCard({
  membershipId,
  details,
  canManage,
}: {
  membershipId: string;
  details: StaffDetails;
  /** Owner or admin: may set the NIF and NISS. */
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useSavedAction(saveDetailsAction, INITIAL);
  const error = (field: string): { error?: string } =>
    state.fields?.[field] === undefined ? {} : { error: t(state.fields[field]) };

  /*
   * Country names come from Intl, whose data differs between Node and the
   * browser, so the list is built after mounting — as the student's form does.
   */
  const [countries, setCountries] = useState<{ value: string; label: string }[]>(() =>
    details.nationality ? [{ value: details.nationality, label: details.nationality }] : [],
  );
  useEffect(() => setCountries(countryOptions(locale)), [locale]);

  const readOnly = (label: string, value: string | null): React.ReactElement => (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-foreground-muted">{label}</span>
      <span>{value ?? '—'}</span>
    </div>
  );

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-1.5 font-medium">
        <UserRound className="size-4" aria-hidden />
        {t('staffDetails.title')}
      </h2>
      <p className="flex items-start gap-1.5 text-sm text-foreground-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('staffDetails.visibility')}
      </p>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="membershipId" value={membershipId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            name="address"
            label={t('staffDetails.address')}
            initial={details.address ?? ''}
            autoComplete="street-address"
            maxLength={200}
            className="max-w-none sm:col-span-2"
            {...error('address')}
          />
          <TextField
            name="postalCode"
            inputMode="numeric"
            label={t('staffDetails.postalCode')}
            initial={details.postalCode ?? ''}
            autoComplete="postal-code"
            maxLength={8}
            className="max-w-none"
            {...error('postalCode')}
          />
          <TextField
            name="locality"
            label={t('staffDetails.locality')}
            initial={details.locality ?? ''}
            autoComplete="address-level2"
            maxLength={100}
            className="max-w-none"
            {...error('locality')}
          />
          <SelectField
            name="nationality"
            label={t('staffDetails.nationality')}
            initial={details.nationality ?? ''}
            options={[{ value: '', label: t('staffDetails.notRecorded') }, ...countries]}
            className="max-w-none"
            {...error('nationality')}
          />
          <TextField
            name="birthplace"
            label={t('staffDetails.birthplace')}
            initial={details.birthplace ?? ''}
            maxLength={120}
            className="max-w-none"
            {...error('birthplace')}
          />
          {canManage ? (
            <>
              <TextField
                name="taxNumber"
                inputMode="numeric"
                label={t('staffDetails.taxNumber')}
                initial={details.taxNumber ?? ''}
                maxLength={11}
                className="max-w-none"
                {...error('taxNumber')}
              />
              <TextField
                name="niss"
                inputMode="numeric"
                label={t('staffDetails.niss')}
                initial={details.niss ?? ''}
                hint={t('staffDetails.nissHint')}
                maxLength={14}
                className="max-w-none"
                {...error('niss')}
              />
            </>
          ) : (
            <>
              {readOnly(t('staffDetails.taxNumber'), details.taxNumber)}
              {readOnly(t('staffDetails.niss'), details.niss)}
            </>
          )}
        </div>

        <fieldset className="flex flex-col gap-3 rounded border border-border p-4">
          <legend className="px-1 text-sm font-medium">{t('staffDetails.emergency')}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              name="emergencyName"
              label={t('staffDetails.emergencyName')}
              initial={details.emergencyName ?? ''}
              maxLength={160}
              className="max-w-none"
              {...error('emergencyName')}
            />
            <TextField
              name="emergencyPhone"
              type="tel"
              inputMode="tel"
              label={t('staffDetails.emergencyPhone')}
              initial={details.emergencyPhone ?? ''}
              maxLength={40}
              className="max-w-none"
              {...error('emergencyPhone')}
            />
            <TextField
              name="emergencyRelation"
              label={t('staffDetails.emergencyRelation')}
              initial={details.emergencyRelation ?? ''}
              placeholder={t('staffDetails.emergencyRelationPlaceholder')}
              maxLength={60}
              className="max-w-none"
              {...error('emergencyRelation')}
            />
          </div>
        </fieldset>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
          >
            {t('staffDetails.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
