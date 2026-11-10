'use client';

import { useTranslations } from 'next-intl';
import { PT_DISTRICTS } from '@poolse/rules';
import { FIELD_LABEL, SelectField, TextField, useSeeded } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { saveSiteDetailsAction } from './facility.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Geral* — the site's details, the first thing the site page opens on (Rui,
 * 10-11-2026: "at the end of the day is a simple page for details of the
 * facility"). Top to bottom: the club's name and the site's name, then *Morada*,
 * *Código postal* and *Localidade*, one *Guardar*.
 *
 * **The names are the owner's** (`canRename`): an admin reads them as text, and
 * the API refuses a rename from anybody else. **The locality is the town picker**
 * (`locality`, passed in), the one value the weather reads, never a second box
 * for the same town; it saves itself when a town is chosen, and Enter inside it
 * never submits this form.
 */
export function SiteDetailsForm({
  facilityId,
  canRename,
  clubName,
  facilityName,
  address,
  postalCode,
  district,
  countryCode,
  countries,
  locality,
}: {
  facilityId: string;
  canRename: boolean;
  clubName: string;
  facilityName: string;
  address: string | null;
  postalCode: string | null;
  district: string | null;
  /** The site's country, the town picker's (one value): País edits it. */
  countryCode: string | null;
  /**
   * Every country, named and sorted on the server. Never named here: Node's and
   * the browser's ICU word some names differently ("Hong Kong"), and a list
   * named twice is a hydration mismatch.
   */
  countries: { value: string; label: string }[];
  /** The town picker, drawn in the locality's place. */
  locality: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(saveSiteDetailsAction, INITIAL);
  const error = (key: string): string | undefined =>
    state.fields?.[key] === undefined ? undefined : t(state.fields[key]);
  // País decides what Distrito is: Portugal's list, or free text elsewhere.
  const [country, setCountry] = useSeeded<string>(countryCode ?? '');

  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      {canRename ? (
        <div className="grid max-w-form grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            name="clubName"
            label={t('facilities.general.clubName')}
            initial={clubName}
            maxLength={120}
            className="max-w-none"
            error={error('clubName')}
          />
          <TextField
            name="facilityName"
            label={t('facilities.general.facilityName')}
            initial={facilityName}
            maxLength={120}
            className="max-w-none"
            hint={t('facilities.general.facilityNameHint')}
            error={error('facilityName')}
          />
        </div>
      ) : (
        // An admin reads the names; changing them is the owner's (and says so).
        <dl className="grid max-w-form grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <dt className={FIELD_LABEL}>{t('facilities.general.clubName')}</dt>
            <dd>{clubName}</dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className={FIELD_LABEL}>{t('facilities.general.facilityName')}</dt>
            <dd>{facilityName}</dd>
          </div>
          <p className="text-sm text-foreground-muted sm:col-span-2">{t('facilities.general.ownerOnly')}</p>
        </dl>
      )}
      <TextField
        name="address"
        label={t('facilities.siteAddress.street')}
        initial={address ?? ''}
        autoComplete="address-line1"
        maxLength={500}
        className="max-w-form"
        error={error('address')}
      />
      <div className="grid max-w-form grid-cols-1 items-start gap-3 sm:grid-cols-[10rem_1fr]">
        <TextField
          name="postalCode"
          label={t('facilities.siteAddress.postalCode')}
          initial={postalCode ?? ''}
          autoComplete="postal-code"
          placeholder="0000-000"
          maxLength={16}
          inputMode="numeric"
          className="max-w-none"
          error={error('postalCode')}
        />
        {locality}
      </div>
      <div className="grid max-w-form grid-cols-1 items-start gap-3 sm:grid-cols-2">
        {country === 'PT' ? (
          <SelectField
            key="pt"
            name="district"
            label={t('facilities.siteAddress.district')}
            initial={district !== null && (PT_DISTRICTS as readonly string[]).includes(district) ? district : ''}
            options={[{ value: '', label: '—' }, ...PT_DISTRICTS.map((one) => ({ value: one, label: one }))]}
            className="max-w-none"
            error={error('district')}
          />
        ) : (
          <TextField
            key="other"
            name="district"
            label={t('facilities.siteAddress.district')}
            initial={district ?? ''}
            autoComplete="address-level1"
            maxLength={80}
            className="max-w-none"
            error={error('district')}
          />
        )}
        <SelectField
          name="countryCode"
          label={t('facilities.siteAddress.country')}
          initial={countryCode ?? ''}
          options={[{ value: '', label: '—' }, ...countries]}
          onValueChange={setCountry}
          className="max-w-none"
          error={error('countryCode')}
        />
      </div>
      <p className="text-sm text-foreground-muted">{t('facilities.siteAddress.hint')}</p>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded-sm bg-primary font-semibold text-primary-foreground outline-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>
    </form>
  );
}
