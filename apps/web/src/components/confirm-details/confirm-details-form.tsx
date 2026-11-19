'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { SignOutButton } from '@clerk/nextjs';
import { ArrowRight, LogOut, Mail, Phone, UserRound, Users, type LucideIcon } from 'lucide-react';
import type { DetailField } from '@poolse/rules';
import { TextField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { confirmDetailsAction } from './confirm-details.actions';

export interface ChildRow {
  id: string;
  name: string;
  relationship: string | null;
}

export interface ClubContact {
  name: string;
  phone: string | null;
  email: string | null;
}

type Values = Record<'firstName' | 'lastName' | 'contactPhone' | 'taxNumber' | 'address' | 'postalCode' | 'locality', string>;

/** The form's field for each detail — the API's own names, so its errors land under the right box. */
const FORM_NAME: Record<DetailField, keyof Values> = {
  firstName: 'firstName',
  lastName: 'lastName',
  mobile: 'contactPhone',
  taxNumber: 'taxNumber',
  address: 'address',
  postalCode: 'postalCode',
  locality: 'locality',
};

const INITIAL: FormState = { ok: false };

/**
 * The gate's form — POOLSE-227. Every required field is `*`, prefilled where the
 * person or the office already gave it, and the first missing one takes the
 * focus. The NIF and morada carry their reason as visible text (the GDPR line),
 * never a tooltip.
 */
export function ConfirmDetailsForm({
  required,
  missing,
  initial,
  taxNumberLocked,
  staffUnreadable,
  children,
  contact,
  confirmLabelKey = 'confirmDetails.confirm',
  birthDate,
  then,
  formId,
  payroll,
}: {
  /**
   * The setup's step 1 (Rui, 19-11-2026): an optional date of birth, the same
   * one *O meu perfil* holds. Undefined, the field is not shown and the saved
   * date is left as it is.
   */
  birthDate?: string;
  /** Where to go once saved — the setup's next step. Only a setup address is honoured. */
  then?: string;
  /**
   * The form's id, for the setup: its *Seguinte* sits in the wizard's bottom bar
   * like every other step's (`DetailsNext`), and submits this form by `form=`.
   */
  formId?: string;
  /** What the button says: *Continuar* when this is a step of creating a club. */
  confirmLabelKey?: string;
  /** Staff: the NIF and the morada are offered, optional (`asksPayrollDetails`). */
  payroll: boolean;
  required: DetailField[];
  missing: DetailField[];
  initial: Values;
  taxNumberLocked: boolean;
  staffUnreadable: boolean;
  /** A guardian's children, read-only; null for anybody else. */
  children: ChildRow[] | null;
  contact: ClubContact | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(confirmDetailsAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const asks = (field: DetailField): boolean => required.includes(field);
  const error = (name: keyof Values): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  // The first missing field takes the focus, once, as the gate appears.
  const first = missing[0];
  useEffect(() => {
    if (first === undefined) return;
    const element = formRef.current?.elements.namedItem(FORM_NAME[first]);
    if (element instanceof HTMLInputElement) element.focus();
  }, [first]);

  return (
    <div className="flex w-full flex-col gap-6">
      <form ref={formRef} id={formId} action={action} className="flex flex-col gap-6">
        <fieldset className="onboard-rise flex flex-col gap-3" style={{ '--i': 1 } as React.CSSProperties}>
          <GroupLegend icon={UserRound} label={t('confirmDetails.groupContact')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            name="firstName"
            label={t('profile.firstName')}
            initial={initial.firstName}
            required={asks('firstName')}
            autoComplete="given-name"
            maxLength={100}
            error={error('firstName')}
          />
          <TextField
            name="lastName"
            label={t('profile.lastName')}
            initial={initial.lastName}
            required={asks('lastName')}
            autoComplete="family-name"
            maxLength={100}
            error={error('lastName')}
          />
        </div>
        {/* With a date of birth beside it, the mobile takes the name's grid (Rui, 19-11-2026). */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          name="contactPhone"
          type="tel"
          inputMode="tel"
          label={t('confirmDetails.mobile')}
          initial={initial.contactPhone}
          required={asks('mobile')}
          autoComplete="tel"
          maxLength={30}
          hint={t('confirmDetails.mobileHint')}
          error={error('contactPhone')}
        />
        {birthDate !== undefined && (
          <TextField
            name="birthDate"
            type="date"
            label={t('profile.birthDate')}
            initial={birthDate}
            autoComplete="bday"
            error={state.fields?.['birthDate'] === undefined ? undefined : t(state.fields['birthDate'] as never)}
          />
        )}
        </div>
        </fieldset>
        {then !== undefined && <input type="hidden" name="then" value={then} />}

        {/*
          Staff: the NIF and the morada, optional and with no heading of their own
          (Rui, 19-11-2026), on the same two columns as the fields above.
        */}
        {payroll && (
          <fieldset className="onboard-rise flex flex-col gap-3" style={{ '--i': 2 } as React.CSSProperties}>
            {staffUnreadable && (
              <p className="text-sm text-danger" role="alert">
                {t('staffDetails.loadFailed')}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              name="taxNumber"
              inputMode="numeric"
              label={t('staffDetails.taxNumber')}
              initial={initial.taxNumber}
              readOnly={taxNumberLocked}
              maxLength={11}
              hint={taxNumberLocked ? t('staffDetails.errors.clubsToSet') : undefined}
              error={error('taxNumber')}
            />
            <TextField
              name="address"
              label={t('staffDetails.address')}
              initial={initial.address}
              autoComplete="street-address"
              maxLength={500}
              error={error('address')}
            />
              <TextField
                name="postalCode"
                label={t('staffDetails.postalCode')}
                initial={initial.postalCode}
                autoComplete="postal-code"
                placeholder="0000-000"
                maxLength={8}
                error={error('postalCode')}
              />
              <TextField
                name="locality"
                label={t('staffDetails.locality')}
                initial={initial.locality}
                autoComplete="address-level2"
                maxLength={120}
                error={error('locality')}
              />
            </div>
            <p className="rounded-sm bg-surface-muted px-3 py-2 text-sm text-foreground-muted">{t('confirmDetails.gdpr')}</p>
          </fieldset>
        )}

        {formId === undefined && (
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control w-full items-center justify-center gap-2 rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground transition-transform disabled:opacity-60 sm:w-auto sm:self-center motion-safe:hover:-translate-y-px"
        >
          {pending ? t('common.working') : t(confirmLabelKey as never)}
          {/* In the setup it is that wizard's Seguinte, with its arrow (Rui, 19-11-2026). */}
          {then !== undefined && !pending && <ArrowRight className="size-4" aria-hidden />}
        </button>
        )}
      </form>

      {children !== null && children.length > 0 && (
        <section aria-labelledby="confirm-details-children" className="flex flex-col gap-3 rounded border border-border p-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="confirm-details-children" className="flex items-center gap-2 text-base font-semibold">
              <Users className="size-4 text-primary" aria-hidden />
              {t('confirmDetails.children')}
            </h2>
            <p className="text-sm text-foreground-muted">{t('confirmDetails.childrenHint')}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {children.map((child) => (
              <li key={child.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col">
                  <span className="font-medium">{child.name}</span>
                  {child.relationship !== null && (
                    <span className="text-sm text-foreground-muted">{child.relationship}</span>
                  )}
                </div>
                <TellTheOffice child={child.name} contact={contact} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        The one way out that is not the form: somebody signed in as the wrong
        person. Not in the setup, where the account menu stays on screen.
      */}
      {then === undefined && (
      <SignOutButton redirectUrl="/">
        <button
          type="button"
          className="inline-flex min-h-control items-center gap-2 self-start text-sm text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <LogOut className="size-4" aria-hidden />
          {t('app.profile.signOut')}
        </button>
      </SignOutButton>
      )}
    </div>
  );
}

/**
 * *Avisar a secretaria* (Rui, 19-11-2026): the club's own email with the child
 * named in the subject, and its published phone. No queue of its own.
 */
function TellTheOffice({ child, contact }: { child: string; contact: ClubContact | null }): React.ReactElement {
  const t = useTranslations();
  if (contact === null || (contact.email === null && contact.phone === null)) {
    return <p className="text-sm text-foreground-muted">{t('confirmDetails.noClubContact')}</p>;
  }
  const subject = encodeURIComponent(t('confirmDetails.tellSubject', { child }));
  const link =
    'inline-flex min-h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card';
  return (
    <div className="flex flex-wrap gap-2">
      {contact.email !== null && (
        <a href={`mailto:${contact.email}?subject=${subject}`} className={link}>
          <Mail className="size-4" aria-hidden />
          {t('confirmDetails.tellOffice')}
        </a>
      )}
      {contact.phone !== null && (
        <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className={link}>
          <Phone className="size-4" aria-hidden />
          {t('confirmDetails.callOffice', { phone: contact.phone })}
        </a>
      )}
    </div>
  );
}

/** A group's heading: an icon in a circle, then the words, which are the legend. */
function GroupLegend({ icon: Icon, label }: { icon: LucideIcon; label: string }): React.ReactElement {
  return (
    <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
      <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon className="size-4" />
      </span>
      {label}
    </legend>
  );
}
