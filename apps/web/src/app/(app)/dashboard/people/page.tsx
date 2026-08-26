import { getFormatter, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type OrganizationMember, type People } from '../../../../lib/api';
import { PersonAvatar } from '@/components/person-avatar';
import { Hint } from '@/components/ui/tooltip';
import { InviteForm } from './invite-form';
import { ReissueButton } from './reissue-button';
import { RevokeButton } from './revoke-button';
import { TransferOwnership } from './transfer-ownership';

/**
 * Slice 0.5 made visible: who is in this organization, who has been asked, and
 * the form that asks.
 *
 * No organization is named in the request. The API derives it from the session
 * and hands it back in the response — a client that can name its own tenant has
 * no tenant isolation at all, whatever the RLS policies say.
 */
export default async function PeoplePage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  let people: People | null = null;
  let failure: string | null = null;
  let noOrganization = false;

  try {
    people = await apiFetch<People>('/people');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      // The API says this account belongs to no organization. Not an error —
      // it is the state everyone starts in, and the dashboard handles it.
      noOrganization = true;
    } else {
      failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('people.title')}</h1>
          <p className="text-foreground-muted">{t('people.subtitle')}</p>
        </div>
      </header>

      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {people !== null && (
        <>
          {!people.canInvite && (
            <p className="text-sm text-foreground-muted">{t('people.ownerOnly')}</p>
          )}

          {people.canInvite && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('invite.title')}
              </h2>
              <InviteForm
                organizationId={people.organizationId}
                grantableRoles={people.grantableRoles}
              />
            </section>
          )}

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('people.members')}
            </h2>
            <ul className="flex flex-col divide-y divide-border">
              {people.members.map((member) => (
                <li
                  key={member.membershipId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <PersonAvatar
                      id={member.membershipId}
                      name={displayName(member) ?? member.email ?? '?'}
                      photoUrl={member.avatarUrl}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{displayName(member) ?? t('account.noName')}</span>
                      {member.email !== null && (
                        <span className="truncate text-sm text-foreground-muted">
                          {member.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {member.status === 'invited' && (
                      // The badge already says "not yet accepted"; the tooltip
                      // only explains what that means for the person, which is
                      // exactly the line CLAUDE.md draws.
                      <Hint text={t('people.pendingHint')}>
                        <span className="cursor-help rounded bg-warning/15 px-2 py-0.5 text-sm text-warning">
                          {t('people.pending')}
                        </span>
                      </Hint>
                    )}
                    {member.roles.map((role) => (
                      <span
                        key={role}
                        className="rounded bg-primary/15 px-2 py-0.5 text-sm text-primary"
                      >
                        {t(`roles.${role}`)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('people.invitations')}
            </h2>

            {people.invitations.length === 0 ? (
              <p className="text-foreground-muted">{t('people.noInvitations')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {people.invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{invitation.email}</span>
                      <span className="text-sm text-foreground-muted">
                        {t('invite.expiresOn', {
                          date: format.dateTime(new Date(invitation.expiresAt), {
                            dateStyle: 'long',
                          }),
                        })}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {invitation.roles.map((role) => (
                        <span
                          key={role}
                          className="rounded bg-primary/15 px-2 py-0.5 text-sm text-primary"
                        >
                          {t(`roles.${role}`)}
                        </span>
                      ))}
                      {people.canInvite && (
                        <>
                          <ReissueButton
                            organizationId={people.organizationId}
                            invitationId={invitation.id}
                          />
                          <RevokeButton
                            organizationId={people.organizationId}
                            invitationId={invitation.id}
                          />
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {people.canTransferOwnership && (
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('transfer.title')}
              </h2>
              <p className="text-sm text-foreground-muted">{t('transfer.explain')}</p>
              <TransferOwnership
                organizationId={people.organizationId}
                candidates={people.members.filter(
                  (member) =>
                    member.roles.includes('admin') &&
                    !member.roles.includes('owner') &&
                    member.status === 'active',
                )}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}

/** Null rather than an empty string, so the caller picks the translated fallback. */
function displayName(member: OrganizationMember): string | null {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ');
  return name.length > 0 ? name : null;
}
