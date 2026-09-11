'use client';

import { useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_LABEL } from '@/components/ui/field';
import type { OrganizationKind } from '@/lib/api';
import { cn } from '@/lib/utils';
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
 *
 * **One question before the name, since 4.5: a club, or your own pool.** The
 * answer decides what the new tenant opens with — a season for a club, a pool
 * for a person — and which sections the navigation shows. It is asked here
 * rather than at sign-up because sign-up is Clerk's screen, and because a
 * person can hold both kinds of account: the same login may run a club by day
 * and log the garden pool at night. Two radios and not a select, so that both
 * answers and what each one means are visible without opening anything.
 */
export function CreateOrganizationForm(): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createOrganizationAction, INITIAL);
  const [kind, setKind] = useState<OrganizationKind>('business');

  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className={FIELD_LABEL}>{t('organization.kindLabel')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <KindOption
            value="business"
            current={kind}
            onChoose={setKind}
            label={t('organization.kindBusiness')}
            hint={t('organization.kindBusinessHint')}
          />
          <KindOption
            value="personal"
            current={kind}
            onChoose={setKind}
            label={t('organization.kindPersonal')}
            hint={t('organization.kindPersonalHint')}
          />
        </div>
      </fieldset>

      <label htmlFor="organization-name" className={FIELD_LABEL}>
        {kind === 'personal' ? t('organization.nameLabelPersonal') : t('organization.nameLabel')}
      </label>
      <input
        id="organization-name"
        name="name"
        required
        maxLength={120}
        placeholder={
          kind === 'personal'
            ? t('organization.namePlaceholderPersonal')
            : t('organization.namePlaceholder')
        }
        className={CONTROL_LINE}
      />

      {/*
        Optional, and blank means "same as the organization". Asking for it here
        rather than leaving the new tenant empty is the difference between
        landing in a product and landing in a form: everything in module 1 hangs
        off a site, so an organization without one cannot do anything yet.

        Not asked of a personal tenant at all — the site and the pool are both
        named after it, and one name is the whole point.
      */}
      {kind === 'business' && (
        <>
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
        </>
      )}

      {kind === 'personal' && (
        <p className="text-sm text-foreground-muted">{t('organization.personalHint')}</p>
      )}

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

/**
 * One of the two answers, as a card with the radio inside it.
 *
 * The whole card is the label, so the click target is the card and not a
 * 16-pixel circle; the hint is visible text rather than a tooltip, because the
 * difference between the two answers is exactly what somebody choosing needs
 * to read.
 */
function KindOption({
  value,
  current,
  onChoose,
  label,
  hint,
}: {
  value: OrganizationKind;
  current: OrganizationKind;
  onChoose: (kind: OrganizationKind) => void;
  label: string;
  hint: string;
}): React.ReactElement {
  const chosen = value === current;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded border p-3 transition-colors',
        chosen ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-muted',
      )}
    >
      <input
        type="radio"
        name="kind"
        value={value}
        checked={chosen}
        onChange={() => onChoose(value)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-foreground-muted">{hint}</span>
      </span>
    </label>
  );
}
