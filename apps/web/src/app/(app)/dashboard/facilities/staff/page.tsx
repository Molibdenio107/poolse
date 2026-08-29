import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type OrganizationMember, type People } from '../../../../../lib/api';
import { DeliveryBadge } from '@/components/delivery-badge';
import { PersonAvatar } from '@/components/person-avatar';
import { RoleBadge, RoleBadges } from '@/components/role-badge';
import { STAFF_ROLES } from '@/lib/roles';
import { backTarget } from '@/lib/back';
import { Pagination } from '@/components/pagination';
import { SearchInput, SearchStatus } from '@/components/search-input';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { Hint } from '@/components/ui/tooltip';
import { InvitePanel } from './invite-panel';
import { ReissueButton } from './reissue-button';
import { RevokeButton } from './revoke-button';
import { TransferOwnership } from './transfer-ownership';
import { PageShell } from '@/components/page-shell';

/**
 * Slice 0.5 made visible: who is in this organization, who has been asked, and
 * the form that asks.
 *
 * No organization is named in the request. The API derives it from the session
 * and hands it back in the response — a client that can name its own tenant has
 * no tenant isolation at all, whatever the RLS policies say.
 */
/**
 * Pessoas is staff — POOLSE-35.
 *
 * Students and encarregados de educação live under Alunos. Two filtered views
 * over one Person, never two record types: somebody holding roles on both sides
 * appears in both, as the same record, edited in either place.
 *
 * The filter chips offer only staff roles for the same reason. A "Alunos" chip
 * here that returned nothing would read as a bug rather than as a boundary.
 */
const ROLES: readonly string[] = STAFF_ROLES;

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; page?: string; search?: string; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  /*
   * Filtered by the API, not in the page — changed by POOLSE-29.
   *
   * It used to fetch every membership and narrow it here, which was reasonable
   * while the list arrived whole. It stops being reasonable the moment the list
   * is a page: narrowing after a window gives page 2 fewer rows than page 1, and
   * a total that counts people the reader cannot see. Scope and role are now
   * part of the same query as the window — and the API enforces the staff
   * boundary rather than trusting this page to (POOLSE-35 criterion 7).
   */
  const { role: requestedRole, page: pageParam, search = '', from } = await searchParams;
  const role = ROLES.includes(requestedRole ?? '') ? requestedRole! : null;
  const page = readPage(pageParam);
  const term = search.trim();

  /*
   * Back goes where you came from — R4.
   *
   * A facility's people counts link straight into this list, and the fixed
   * "Voltar ao painel" then dropped somebody two screens from the site they were
   * reading. Arrive here any other way and there is no `from`, so this is
   * `/dashboard` exactly as before. Validated in `lib/back.ts`: an unchecked
   * back target is an open redirect.
   */
  const back = backTarget(from, '/dashboard');

  let people: People | null = null;
  let failure: string | null = null;
  let noOrganization = false;
  let notPermitted = false;

  try {
    people = await apiFetch<People>(`/people?${new URLSearchParams({
      scope: 'staff',
      ...(role === null ? {} : { role }),
      ...(term === '' ? {} : { search: term }),
      ...(page > 1 ? { page: String(page) } : {}),
    })}`);
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

  /*
   * Staff only — POOLSE-35, criterion 7. The API applies that scope, so this
   * view cannot return students or guardians even if somebody edits the URL.
   *
   * A person holding two staff roles appears once with both badges, which is how
   * the schema stores them and how R2-2 specifies the sub-sections should show
   * them.
   */
  const members = people?.members.items ?? [];

  if (people !== null && isPastEnd(page, people.members.total, people.members.limit)) {
    redirect(
      pageHref(
        '/dashboard/facilities/staff',
        { role: role ?? undefined, search: term },
        lastPage(people.members.total, people.members.limit),
      ),
    );
  }

  return (
    <PageShell
      title={t('staff.title')}
      subtitle={t('staff.subtitle')}
      back={{ href: back.href, label: t(back.labelKey) }}
      actions={<Link
          href="/dashboard/facilities/staff/duplicates"
          className="shrink-0 rounded border border-border px-4 py-2 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('people.duplicates')}
        </Link>}
    >

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
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('people.members')}
              </h2>

              {/*
                How big the team is, beside the word "Membros" — R4.
                
                The list already showed a total, but it was the total of the
                current filter: "3" under the Instrutor chip, with nothing on
                screen saying that was three instructors rather than three staff.
                So the headline is the headcount, and the roles are broken out
                beside it.
                
                **The role numbers do not sum to the total, on purpose.** An
                admin who also instructs is one member of staff and appears under
                both roles; adding them up would report a team larger than the
                room. `people.staffCountHint` says so rather than leaving it to
                be discovered by arithmetic.
                
                Each chip is the filter it describes — the count and the way to
                see who is in it are the same control, because a number somebody
                cannot click is a number they then go looking for.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <Hint text={t('people.staffCountHint')}>
                  <span className="cursor-help text-sm">
                    {t('people.staffTotal', { count: people.counts.total })}
                  </span>
                </Hint>

                {ROLES.map((staffRole) => {
                  const active = role === staffRole;
                  return (
                    <Link
                      key={staffRole}
                      href={active ? '/dashboard/facilities/staff' : `/dashboard/facilities/staff?role=${staffRole}`}
                      aria-pressed={active}
                      className={`rounded border px-2 py-0.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        active
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border text-foreground-muted hover:border-primary/50 hover:text-foreground'
                      }`}
                    >
                      {t(`roles.${staffRole}`)} {people.counts.byRole[staffRole] ?? 0}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/*
              Name or email — what a staff row shows. Searching alongside the
              role chips rather than instead of them: "the instructors called
              Silva" is a question somebody actually has. POOLSE-30.
            */}
            <div className="mb-4">
              <SearchInput
                label={t('search.label')}
                placeholder={t('staff.searchPlaceholder')}
              />
            </div>

            <SearchStatus total={people.members.total} term={term} />

            {members.length === 0 && term !== '' && (
              <div className="flex flex-col items-start gap-1 py-2">
                <p>{t('search.noResults', { term })}</p>
                <p className="text-sm text-foreground-muted">{t('search.noResultsHint')}</p>
                <Link
                  href={role === null ? '/dashboard/facilities/staff' : `/dashboard/facilities/staff?role=${role}`}
                  className="mt-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {t('search.clearSearch')}
                </Link>
              </div>
            )}

            {role !== null && (
              <p className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                <RoleBadge role={role} />
                <Link href="/dashboard/facilities/staff" className="text-primary hover:underline">
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
                      {/* The record is where a name is corrected — POOLSE-39. */}
                      <Link
                        href={`/dashboard/facilities/staff/${member.membershipId}`}
                        className="truncate rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {displayName(member) ?? t('account.noName')}
                      </Link>
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
                    <RoleBadges roles={member.roles} />
                  </div>
                </li>
              ))}
            </ul>

            {/*
              `query` carries the role chip, so paging keeps the filter. The
              chips themselves link without a page param, which resets to page 1
              — criterion 5.
            */}
            <Pagination
              page={people.members}
              basePath="/dashboard/facilities/staff"
              query={{ role: role ?? undefined, search: term }}
            />
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
                      <RoleBadges roles={invitation.roles} />
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
              {/*
                Every admin, from its own query — not from the members page.
                Filtering the page would have offered only the admins who
                happened to land on page 1, and told the owner their colleague
                was not an admin — POOLSE-29.
              */}
              <TransferOwnership
                organizationId={people.organizationId}
                candidates={people.transferCandidates}
              />
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

/**
 * The name a staff row shows — POOLSE-32.
 *
 * Composed by the server and passed straight through, rather than assembled
 * here from the parts as it used to be. Null rather than an empty string, so
 * the caller picks the translated fallback for somebody invited who has not yet
 * accepted and has no name anywhere.
 */
function displayName(member: OrganizationMember): string | null {
  return member.shortName;
}
