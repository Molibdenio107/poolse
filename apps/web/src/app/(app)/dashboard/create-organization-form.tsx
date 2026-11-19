'use client';

import { useState } from 'react';
import { Building2, Check, House, type LucideIcon } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_LABEL, useSeeded } from '@/components/ui/field';
import { Reveal } from '@/components/ui/reveal';
import type { OrganizationKind } from '@/lib/api';
import { cn } from '@/lib/utils';
import { createOrganizationAction, type FormState } from './actions';

const INITIAL: FormState = { ok: false };

/** POOLSE-227: whether the form offers *A minha piscina*. One line brings it back. */
const OFFER_PERSONAL = false;

/**
 * The way out of belonging to nothing.
 *
 * Every account starts here — signing up creates an identity, not a tenant — so
 * this form is the first interactive thing most people will ever touch in
 * Poolse. **It stays one screen:** nothing stands between a person and their
 * club but its name and how families reach it. What changed on 19-11-2026 (Rui,
 * POOLSE-228, partly reversing "no wizard") is what comes *after* it: the
 * Owner's setup steps, every one skippable, so the guide never becomes the wall
 * that a six-step form before the first screen would be. The questions are
 * grouped and numbered so the page reads as short steps (10-11-2026).
 *
 * **A club or your own pool: the second answer is not offered since
 * 19-11-2026** (Rui, POOLSE-227). Slice 4.5's personal tenant stays whole — the
 * kind, the API, `provision_organization`'s branch, every screen — and the one
 * that exists keeps working; the form simply opens on the club. `OFFER_PERSONAL`
 * brings back the two radio cards, and with them *a minha piscina* folding the
 * club-only fields away with `Reveal`. A hand-posted `kind=personal` still makes
 * a personal tenant, as before: the action and the API are unchanged.
 *
 * On success the action sends the browser to `/dashboard/welcome`.
 */
export function CreateOrganizationForm({ ownerEmail }: { ownerEmail: string }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createOrganizationAction, INITIAL);
  const [kind, setKind] = useState<OrganizationKind>('business');
  const [name, setName] = useSeeded<string>('');
  const [facilityName, setFacilityName] = useSeeded<string>('');
  // POOLSE-209: where families' replies go, the creator's own address to start with.
  const [replyEmail, setReplyEmail] = useSeeded<string>(ownerEmail);
  // POOLSE-210: the club's phone starts blank — an owner's own mobile is not the club's to publish.
  const [contactPhone, setContactPhone] = useSeeded<string>('');
  const business = kind === 'business';

  return (
    <form action={action} className="flex flex-col gap-6">
      {OFFER_PERSONAL && (
        <fieldset className="onboard-rise flex flex-col gap-3" style={{ '--i': 0 } as React.CSSProperties}>
          <StepLegend step={1} label={t('organization.kindLabel')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KindOption
              value="business"
              current={kind}
              onChoose={setKind}
              icon={Building2}
              label={t('organization.kindBusiness')}
              hint={t('organization.kindBusinessHint')}
            />
            <KindOption
              value="personal"
              current={kind}
              onChoose={setKind}
              icon={House}
              label={t('organization.kindPersonal')}
              hint={t('organization.kindPersonalHint')}
            />
          </div>
        </fieldset>
      )}

      <fieldset className="onboard-rise flex flex-col gap-2" style={{ '--i': 1 } as React.CSSProperties}>
        <StepLegend step={OFFER_PERSONAL ? 2 : 1} label={business ? t('onboarding.stepClub') : t('onboarding.stepPool')} />
        <label htmlFor="organization-name" className={FIELD_LABEL}>
          {business ? t('organization.nameLabel') : t('organization.nameLabelPersonal')}
        </label>
        <input
          id="organization-name"
          name="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder={business ? t('organization.namePlaceholder') : t('organization.namePlaceholderPersonal')}
          className={CONTROL_LINE}
        />

        {/*
          Optional, and blank means "same as the organization". Asking for it here
          rather than leaving the new tenant empty is the difference between
          landing in a product and landing in a form: everything in module 1 hangs
          off a site. Not asked of a personal tenant — the site and the pool are
          both named after it, and one name is the whole point.
        */}
        <Reveal open={business}>
          <div className="flex flex-col gap-2 pt-2">
            <label htmlFor="organization-facility" className={FIELD_LABEL}>
              {t('organization.facilityLabel')}
            </label>
            <input
              id="organization-facility"
              name="facilityName"
              value={facilityName}
              onChange={(event) => setFacilityName(event.target.value)}
              maxLength={120}
              placeholder={t('organization.facilityPlaceholder')}
              className={CONTROL_LINE}
            />
            <p className="text-sm text-foreground-muted">{t('organization.facilityHint')}</p>
          </div>
        </Reveal>

        <Reveal open={!business}>
          <p className="pt-1 text-sm text-foreground-muted">{t('organization.personalHint')}</p>
        </Reveal>
      </fieldset>

      <Reveal open={business}>
        <fieldset className="onboard-rise flex flex-col gap-2" style={{ '--i': 2 } as React.CSSProperties}>
          <StepLegend step={OFFER_PERSONAL ? 3 : 2} label={t('onboarding.stepContacts')} />

          {/* POOLSE-209 (Rui, 09-11-2026): asked now, changed later in Dados do clube. */}
          <label htmlFor="organization-reply-email" className={FIELD_LABEL}>
            {t('organization.replyEmailLabel')}
          </label>
          <input
            id="organization-reply-email"
            name="replyEmail"
            type="email"
            autoComplete="email"
            value={replyEmail}
            onChange={(event) => setReplyEmail(event.target.value)}
            maxLength={254}
            className={CONTROL_LINE}
          />
          {state.fields?.['replyEmail'] !== undefined && (
            <p className="text-sm text-danger" role="alert">
              {t(state.fields['replyEmail'])}
            </p>
          )}

          {/* POOLSE-210 (Rui, 10-11-2026): optional, changed later in Dados do clube. */}
          <label htmlFor="organization-contact-phone" className={cn(FIELD_LABEL, 'pt-2')}>
            {t('organization.contactPhoneLabel')}
          </label>
          <input
            id="organization-contact-phone"
            name="contactPhone"
            type="tel"
            autoComplete="tel"
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            maxLength={32}
            className={CONTROL_LINE}
          />
          {state.fields?.['contactPhone'] !== undefined && (
            <p className="text-sm text-danger" role="alert">
              {t(state.fields['contactPhone'])}
            </p>
          )}
        </fieldset>
      </Reveal>

      <div className="onboard-rise flex flex-col gap-2" style={{ '--i': 3 } as React.CSSProperties}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control w-full items-center justify-center gap-2 rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground transition-transform disabled:opacity-60 sm:w-auto sm:self-start motion-safe:hover:-translate-y-px"
        >
          {pending ? t('common.working') : business ? t('organization.create') : t('onboarding.createPersonal')}
        </button>
        <p className="text-sm text-foreground-muted">{t('onboarding.changeLater')}</p>

        {state.errorKey !== undefined && (
          <p className="text-sm text-danger" role="alert">
            {t(state.errorKey)}
            {state.detail !== undefined && (
              <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
            )}
          </p>
        )}
      </div>
    </form>
  );
}

/** "1  O que vai gerir?" — the number is decoration, the words are the legend. */
function StepLegend({ step, label }: { step: number; label: string }): React.ReactElement {
  return (
    <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
      <span
        aria-hidden
        className="inline-flex size-6 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary"
      >
        {step}
      </span>
      {label}
    </legend>
  );
}

/**
 * One of the two answers, as a card with the radio inside it.
 *
 * The whole card is the label, so the click target is the card and not a
 * 16-pixel circle; the hint is visible text rather than a tooltip, because the
 * difference between the two answers is exactly what somebody choosing needs
 * to read. The chosen card says so three ways — border, tint and a tick — so
 * colour is never the only sign.
 */
function KindOption({
  value,
  current,
  onChoose,
  icon: Icon,
  label,
  hint,
}: {
  value: OrganizationKind;
  current: OrganizationKind;
  onChoose: (kind: OrganizationKind) => void;
  icon: LucideIcon;
  label: string;
  hint: string;
}): React.ReactElement {
  const chosen = value === current;
  return (
    <label
      className={cn(
        'relative flex cursor-pointer items-start gap-3 rounded border-2 p-4 transition-[background-color,border-color,transform,box-shadow] duration-300 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
        chosen
          ? 'border-primary bg-primary/10 shadow-card'
          : 'border-border hover:bg-surface-muted motion-safe:hover:-translate-y-0.5',
      )}
    >
      <input
        type="radio"
        name="kind"
        value={value}
        checked={chosen}
        onChange={() => onChoose(value)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-300',
          chosen ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-foreground-muted',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="flex flex-col gap-1 pr-6">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-foreground-muted">{hint}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          'absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-300',
          chosen ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </label>
  );
}
