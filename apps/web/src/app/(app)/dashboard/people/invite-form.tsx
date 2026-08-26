'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { inviteAction, type InviteState } from '../actions';
import { InvitationLink } from './invitation-link';

const INITIAL: InviteState = { ok: false };

/**
 * Issue an invitation, then show the link.
 *
 * The link is on screen because nothing sends it yet — the notification
 * providers are an open phase 0 decision and delivery is slice 3.0. Copying a
 * link into WhatsApp is a worse product than an email arriving, and it is a
 * complete one: the token, the expiry and the redemption path are all real, only
 * the transport is manual.
 *
 * It is shown exactly once. The API returns the raw token in the response that
 * creates it and never again, because the database only holds its hash.
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
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />

        <div className="flex flex-col gap-2">
          <label htmlFor="invite-email" className="text-sm text-foreground-muted">
            {t('invite.emailLabel')}
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder={t('invite.emailPlaceholder')}
            className="rounded border border-border bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-foreground-muted">{t('invite.rolesLabel')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {grantableRoles.map((role) => (
              <label key={role} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="roles"
                  value={role}
                  className="size-4 accent-primary"
                />
                <span>{t(`roles.${role}`)}</span>
              </label>
            ))}
          </div>
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
