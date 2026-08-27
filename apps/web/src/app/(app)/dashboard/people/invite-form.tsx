'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { TextField, useFocusFirstError } from '@/components/ui/field';
import { inviteAction, type InviteState } from '../actions';
import { InvitationLink } from './invitation-link';

const INITIAL: InviteState = { ok: false };

/**
 * Issue an invitation, then show the link.
 *
 * The link is on screen because delivery is a configuration away rather than a
 * feature away: the API composes and sends the email, and `EMAIL_PROVIDER=console`
 * logs it instead. Copying a link into WhatsApp is a worse product than an email
 * arriving, and it is a complete one — the token, the expiry and the redemption
 * path are all real, only the transport is manual.
 *
 * It is shown exactly once. The API returns the raw token in the response that
 * creates it and never again, because the database only holds its hash.
 *
 * **The typed address survives a rejection** — POOLSE-09. React 19 resets a form
 * once its action returns, including on a validation error, so an uncontrolled
 * input wiped the misspelling the person had just been asked to correct.
 * `TextField` is controlled, which is the documented way out and now the house
 * pattern for every form here.
 */
export function InviteForm({
  organizationId,
  grantableRoles,
}: {
  organizationId: string;
  grantableRoles: string[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(inviteAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);

  useFocusFirstError(form, state.fields, state.attempt);

  const errorFor = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key);
  };

  return (
    <div className="flex flex-col gap-4">
      <form ref={form} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />

        <TextField
          name="email"
          type="email"
          label={t('invite.emailLabel')}
          placeholder={t('invite.emailPlaceholder')}
          error={errorFor('email')}
          autoComplete="email"
          maxLength={200}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-foreground-muted">{t('invite.rolesLabel')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {grantableRoles.map((role) => (
              <label key={role} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="roles"
                  value={role}
                  // Marked invalid so `useFocusFirstError` can find it, and so a
                  // screen reader is told the group is the problem.
                  aria-invalid={state.fields?.['roles'] === undefined ? undefined : true}
                  className="size-4 accent-primary"
                />
                <span>{t(`roles.${role}`)}</span>
              </label>
            ))}
          </div>
          {state.fields?.['roles'] !== undefined && (
            <p className="text-sm text-danger">{t(state.fields['roles'])}</p>
          )}
        </fieldset>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
          >
            {pending ? t('common.working') : t('invite.submit')}
          </button>
        </div>

        {/* Only for a failure that belongs to no field — the API being down. */}
        {state.errorKey !== undefined && (
          <p className="text-sm text-danger">
            {t(state.errorKey)}
            {state.detail !== undefined && (
              <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
            )}
          </p>
        )}
      </form>

      {state.invitation !== undefined && <InvitationLink invitation={state.invitation} />}
    </div>
  );
}
