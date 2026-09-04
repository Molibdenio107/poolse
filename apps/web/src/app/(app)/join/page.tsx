import { UserButton } from '@clerk/nextjs';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type InvitationPreview, type Me } from '../../../lib/api';
import { PreferenceControls } from '../preference-controls';
import { AcceptForm } from './accept-form';
import { PageError, PageShell } from '@/components/page-shell';

/**
 * The invitee's side of slice 0.5.
 *
 * Not a public route: the Clerk middleware requires a session, which means
 * someone arriving with a link and no account is sent to sign up and returned
 * here afterwards. That order is deliberate — an invitation binds an
 * organization to an `app_user`, so the account has to exist first.
 *
 * The screen shows what is being offered before it is accepted. An invitation
 * carries roles, and "you are about to become an instructor at Clube A" is
 * information the person should have before the button, not after it.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { token } = await searchParams;

  let preview: InvitationPreview | null = null;
  let failure: LoadFailure | null = null;

  // Who is about to accept. The invitation names an address, but the token is
  // what actually grants membership — so if somebody is signed in as one person
  // and opens a link meant for another, it is that first account that joins.
  // Silently. Saying whose account this is turns a trap into a choice.
  let me: Me | null = null;
  try {
    me = await apiFetch<Me>('/me');
  } catch {
    // The invitation still renders; the accept button will report the problem.
  }

  if (token) {
    try {
      preview = await apiFetch<InvitationPreview>(
        `/join/preview?token=${encodeURIComponent(token)}`,
      );
    } catch (error) {
      failure = describeLoad(error);
    }
  }

  return (
    <PageShell
      title={t('join.title')}
      subtitle={t('app.tagline')}
      back={{ href: "/dashboard", label: t('common.backToDashboard') }}
      actions={
        <>
          <PreferenceControls />
          <UserButton />
        </>
      }
    >

      {!token && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('join.tokenMissing')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {preview !== null && preview.status !== 'pending' && (
        <section className="rounded border border-border bg-surface p-5">
          <p className="font-medium">{t(`join.status.${preview.status}`)}</p>
          <p className="mt-1 text-sm text-foreground-muted">{t('join.statusHint')}</p>
        </section>
      )}

      {preview !== null && preview.status === 'pending' && token !== undefined && (
        <section className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
          <div className="flex flex-col gap-1">
            <p className="text-lg">
              {t('join.invitedTo', { organization: preview.organizationName ?? '' })}
            </p>
            {preview.email !== null && (
              <p className="text-sm text-foreground-muted">
                {t('join.invitedAddress', { email: preview.email })}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground-muted">{t('join.rolesOffered')}</span>
            <span className="flex flex-wrap gap-1">
              {preview.roles.map((role) => (
                <span key={role} className="rounded bg-primary/15 px-2 py-0.5 text-sm text-primary">
                  {t(`roles.${role}`)}
                </span>
              ))}
            </span>
          </div>

          {preview.expiresAt !== null && (
            <p className="text-sm text-foreground-muted">
              {t('invite.expiresOn', {
                date: format.dateTime(new Date(preview.expiresAt), { dateStyle: 'long' }),
              })}
            </p>
          )}

          {me !== null && (
            <div className="flex flex-col gap-1 rounded border border-border bg-surface-muted p-4">
              <p className="text-sm">
                {t('join.acceptingAs', { email: me.user.email ?? t('account.noEmail') })}
              </p>
              {preview.email !== null &&
                me.user.email !== null &&
                preview.email.toLowerCase() !== me.user.email.toLowerCase() && (
                  <p className="text-sm text-warning">{t('join.differentAccount')}</p>
                )}
            </div>
          )}

          <AcceptForm token={token} organizationName={preview.organizationName ?? ''} />
        </section>
      )}

    </PageShell>
  );
}
