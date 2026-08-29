'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_LABEL } from '@/components/ui/field';
import { createOrganizationAction, type FormState } from './actions';

const INITIAL: FormState = { ok: false };

/**
 * The way out of belonging to nothing.
 *
 * Every account starts here — signing up creates an identity, not a tenant — so
 * this form is the first interactive thing most people will ever touch in
 * Poolse. It asks for one field on purpose: everything else about an
 * organization can be edited later, and a six-field wizard between someone and
 * their first screen is how trials end.
 */
export function CreateOrganizationForm(): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createOrganizationAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="organization-name" className={FIELD_LABEL}>
        {t('organization.nameLabel')}
      </label>
      <input
        id="organization-name"
        name="name"
        required
        maxLength={120}
        placeholder={t('organization.namePlaceholder')}
        className={CONTROL_LINE}
      />

      {/*
        Optional, and blank means "same as the organization". Asking for it here
        rather than leaving the new tenant empty is the difference between
        landing in a product and landing in a form: everything in module 1 hangs
        off a site, so an organization without one cannot do anything yet.
      */}
      <label htmlFor="organization-facility" className={FIELD_LABEL}>
        {t('organization.facilityLabel')}
      </label>
      <input
        id="organization-facility"
        name="facilityName"
        maxLength={120}
        placeholder={t('organization.facilityPlaceholder')}
        className={CONTROL_LINE}
      />
      <p className="text-sm text-foreground-muted">{t('organization.facilityHint')}</p>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('organization.create')}
        </button>
      </div>

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">
          {t(state.errorKey)}
          {state.detail !== undefined && (
            <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
          )}
        </p>
      )}
    </form>
  );
}
