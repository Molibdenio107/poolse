import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type OrganizationMember, type People } from '../../../../lib/api';
import { DeliveryBadge } from '@/components/delivery-badge';
import { PersonAvatar } from '@/components/person-avatar';
import { Hint } from '@/components/ui/tooltip';
import { InvitePanel } from './invite-panel';
import { ReissueButton } from './reissue-button';
import { RevokeButton } from './revoke-button';
import { TransferOwnership } from './transfer-ownership';
import { BackLink } from '@/components/back-link';

/**
 * Slice 0.5 made visible: who is in this organization, who has been asked, and
 * the form that asks.
 *
 * No organization is named in the request. The API derives it from the session
 * and hands it back in the response — a client that can name its own tenant has
 * no tenant isolation at all, whatever the RLS policies say.
 */
/** The `member_role` enum, for validating what arrives in the query string. */
const ROLES = ['owner', 'admin', 'instructor', 'maintenance', 'student', 'guardian'];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  /*
   * Filtered in the page rather than the API — backlog round 3, story 2.
   *
   * The list is one organization's staff: tens of rows, already fetched, already
   * carrying every member's roles. A query parameter on the endpoint would buy
   * nothing and would have to be kept in step with the RLS-scoped read. When
   * story R2-2 builds the real sub-sections this is where they start.
   */
  const { role: requestedRole } = await searchParams;
  const role = ROLES.includes(requestedRole ?? '') ? requestedRole! : null;

  let people: People | null = null;
  let failure: string | null = null;
  let noOrganization = false;
  let notPermitted = false;

  try {
    people = await apiFetch<People>('/people');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      // Two different refusals arrive as 403 and they need two different
      // screens: one is "you are in no organization yet", which everybody starts
      // as and the dashboard knows how to fix, and the other is "this page is
      // not for your role", which is story 8 working. Told apart by the API's
      // `code`, never by the message.
      if (error.code === 'forbidden_role') notPermitted = true;
      else noOrganization = true;
    } else {
      failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
    }
  }

  // A person holding two roles appears under both, which is how the schema
  // stores them and how R2-2 specifies the sub-sections should show them.
  const members =
    people === null
      ? []
      : role === null
        ? people.members
        : people.members.filter((member) => member.roles.includes(role));

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

      {/*
        A refusal, in words, rather than the blank page a hidden menu item plus an
        empty response would produce. Someone who typed the URL or followed an old
        bookmark is not doing anything wrong and should be told what happened and
        where to go instead.
      */}
      {notPermitted && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <p className="font-medium">{t('people.restricted')}</p>
          <p className="text-sm text-foreground-muted">{t('people.restrictedHint')}</p>
          <BackLink href="/dashboard" label={t('common.backToDashboard')} />
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
            <InvitePanel
              organizationId={people.organizationId}
              grantableRoles={people.grantableRoles}
            />
          )}

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('people.members')}
            </h2>
            {role !== null && (
              <p className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded bg-primary/15 px-2 py-0.5 text-primary">
                  {t(`roles.${role}`)}
                </span>
                <Link href="/dashboard/people" className="text-primary hover:underline">
                  {t('people.showAll')}
                </Link>
              </p>
            )}

            <ul className="flex flex-col divide-y divide-border">
              {members.map((member) => (
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
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate">{invitation.email}</span>
                        {/*
                          Whether the message actually went — backlog round 4,
                          ticket 5. Without it, an invitation that failed to send
                          looks exactly like one that succeeded the moment you
                          navigate away, and the operator waits for somebody who
                          was never written to.
                        */}
                        <DeliveryBadge delivery={invitation.delivery} />
                      </span>
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
