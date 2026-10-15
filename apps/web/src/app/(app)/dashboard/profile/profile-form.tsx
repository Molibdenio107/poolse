'use client';

import { useEffect } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
// Aliased: every control in this file is single-line, so one name serves both.
import { CONTROL_INVALID as INVALID, CONTROL_LINE as FIELD, FIELD_COLUMN, FIELD_LABEL, useSeeded } from '@/components/ui/field';
import type { Me } from '@/lib/api';
import { applyTheme } from '@/lib/apply-theme';
import { isTheme } from '@/lib/theme';
import { saveProfileAction, type ProfileState } from './profile.actions';

const INITIAL: ProfileState = { ok: false };

const LOCALES = ['pt-PT', 'en'] as const;
const THEMES = ['light', 'dark', 'system'] as const;

/**
 * "O meu perfil" — backlog round 3, story 1.
 *
 * Two kinds of field on one form, and the split is invisible to the person
 * filling it in, which is the point. The name goes to Clerk, which owns it. Birth
 * date, phone, language and theme are Poolse's. The API keeps that straight; this
 * form just submits everything at once.
 *
 * Errors render beside their field. A banner at the top saying "there were
 * problems" makes someone hunt for which of six inputs it meant, and on a form
 * this short there is no excuse for it.
 */
export function ProfileForm({ me }: { me: Me }): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const [state, action, pending] = useSavedAction(saveProfileAction, INITIAL);

  useEffect(() => {
    if (!state.ok) return;

    // The theme, in this browser, now. The class it toggles sits on `<html>`,
    // above the tree a server action re-renders, so saving it is not enough —
    // the same reason ThemeToggle calls this too.
    if (state.theme !== undefined && isTheme(state.theme)) applyTheme(state.theme);

    /*
     * Clerk's UserButton renders from its own client-side copy of the user, not
     * from anything the server just sent. Without this reload the name in the
     * header keeps the old value until a hard refresh — which is the "changes
     * appear immediately in the header" the story asks for, failing in the one
     * place everybody looks first.
     */
    void user?.reload();
    router.refresh();
  }, [state.ok, state.theme, user, router]);

  const errorFor = (field: string): string | undefined => state.fields?.[field];

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="firstName"
          label={t('profile.firstName')}
          initial={me.user.firstName ?? ''}
          error={errorFor('firstName')}
          autoComplete="given-name"
        />
        <Field
          name="lastName"
          label={t('profile.lastName')}
          initial={me.user.lastName ?? ''}
          error={errorFor('lastName')}
          autoComplete="family-name"
        />
        <Field
          name="birthDate"
          type="date"
          label={t('profile.birthDate')}
          initial={me.user.birthDate ?? ''}
          error={errorFor('birthDate')}
          autoComplete="bday"
        />
        <Field
          name="contactPhone"
          type="tel"
          label={t('profile.contactPhone')}
          initial={me.user.contactPhone ?? ''}
          error={errorFor('contactPhone')}
          autoComplete="tel"
          hint={t('profile.contactPhoneHint')}
        />
      </div>

      {/*
        Read-only, with the way to change it beside it. Clerk owns the email, and
        changing one means proving you can receive mail at the new address — a
        flow with its own screens, which Clerk already has. A plain text field
        here would either not work or would work without verification, and the
        second is worse.
      */}
      <div className={FIELD_COLUMN}>
        <span className={FIELD_LABEL}>{t('profile.email')}</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">{me.user.email ?? t('account.noEmail')}</span>
          <button
            type="button"
            onClick={() => openUserProfile()}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border transition-colors hover:border-primary/50 hover:text-primary"
          >
            {t('profile.changeEmail')}
          </button>
        </div>
        <p className="text-sm text-foreground-muted">{t('profile.emailHint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Choice
          name="locale"
          label={t('profile.locale')}
          initial={me.user.locale}
          options={LOCALES.map((value) => ({ value, label: t(`locale.${value}`) }))}
          error={errorFor('locale')}
        />
        <Choice
          name="theme"
          label={t('profile.theme')}
          initial={me.user.theme}
          options={THEMES.map((value) => ({ value, label: t(`theme.${value}`) }))}
          error={errorFor('theme')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>

      </div>

      {/* Only for a failure that belongs to no field — the API being down, say. */}
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

function Field({
  name,
  label,
  initial,
  error,
  type = 'text',
  autoComplete,
  hint,
}: {
  name: string;
  label: string;
  /** The saved value; re-seeded only when it changes (`useSeeded`). */
  initial: string;
  error?: string | undefined;
  type?: string;
  autoComplete?: string;
  hint?: string;
}): React.ReactElement {
  const t = useTranslations();
  const id = `profile-${name}`;
  const [value, setValue] = useSeeded<string>(initial);

  // Both the hint and the error are announced, and the error is listed first so
  // a screen reader says what is wrong before it says what was expected.
  const described = [
    error === undefined ? null : `${id}-error`,
    hint === undefined ? null : `${id}-hint`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={FIELD_COLUMN}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoComplete={autoComplete}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={described === '' ? undefined : described}
        className={`${FIELD} ${error === undefined ? '' : INVALID}`}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {t(error)}
        </p>
      )}
    </div>
  );
}

function Choice({
  name,
  label,
  initial,
  options,
  error,
}: {
  name: string;
  label: string;
  initial: string;
  options: { value: string; label: string }[];
  error?: string | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const id = `profile-${name}`;
  const [value, setValue] = useSeeded<string>(initial);

  return (
    <div className={FIELD_COLUMN}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        className={`${FIELD} ${error === undefined ? '' : INVALID}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {t(error)}
        </p>
      )}
    </div>
  );
}
