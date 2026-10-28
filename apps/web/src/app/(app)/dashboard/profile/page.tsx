import { MessagePreferenceCard } from './message-preference-card';
import { FromLink } from '@/components/from-link';
import { getTranslations } from 'next-intl/server';
import { describeLoad, outcome, type LoadFailure, type Outcome } from '@/lib/load-failure';
import { apiFetch, type ActiveSession, type Me, type People } from '@/lib/api';
import { backTarget } from '@/lib/back';
import { ProfileForm } from './profile-form';
import { TransferOwnership } from './transfer-ownership';
import { SupportAccess } from './support-access';
import { loadSupportAccess } from '../support.actions';
import { Sessions } from '../sessions';
import { PhotoUpload } from '@/components/photo-upload';
import { PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import { formatStamp } from '@/lib/date-format';
import { subscriptionAlertSentence, type SubscriptionAlertView } from '@/lib/subscription-alert';
import { AlertTriangle } from 'lucide-react';

/**
 * "O meu perfil" — backlog round 3, story 1.
 *
 * Everybody gets this screen, and it is the only one in the backoffice where
 * that is true: an instructor cannot see People, cannot manage turmas and cannot
 * reach the register, but their own name is theirs. There is no role check here
 * on purpose, and the API has none either — `PUT /me/profile` writes to the
 * caller's own identity and cannot be pointed at anybody else's, which is a
 * stronger guarantee than a role would be.
 *
 * It also carries what used to sit on the dashboard and did not belong there:
 * the licence and trial state, the list of organizations this account belongs
 * to, and — from Pessoas — the transfer of ownership.
 *
 * Round 4 finished that move. This organization and these roles, and the list of
 * devices this account is signed in on, were the last two things the dashboard
 * was answering; both are questions about the account, so both are here. The
 * identity card that sat above them on the dashboard did not come with them —
 * `ProfileForm` is already the name and the email, editable, and showing them a
 * second time read-only on the same page would be two versions of one fact.
 *
 * **Tabs since the detail-tabs change**: General (the profile, the
 * subscription link, the trial and this organization), Organizações (only with
 * more than one), Sessões and Transferência (owner).
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { tab, from } = await searchParams;

  let me: Me | null = null;
  let failure: LoadFailure | null = null;

  try {
    me = await apiFetch<Me>('/me');
  } catch (error) {
    failure = describeLoad(error);
  }

  /*
   * Best-effort, and a refusal is not an error here.
   *
   * `GET /people` is owner and admin only; for an instructor it answers 403
   * with `forbidden_role`, which is the API working rather than anything going
   * wrong. This page belongs to everybody, so the whole fetch is wrapped and
   * a refusal leaves the page without the transfer block. Any other failure
   * keeps the tab and says so inside it (13-10-2026 sweep): it used to drive
   * `visible:` too, so a 500 made the Owner's transfer tab vanish. Never a
   * banner over the page — the one screen an instructor can always open.
   *
   * The smallest page of members the API will give, because nothing here reads
   * the list: the transfer picker gets `transferCandidates`, which is every
   * admin and is not paginated — POOLSE-29.
   */
  const people: Outcome<People> =
    me === null ? { state: 'refused' } : await outcome(apiFetch<People>('/people?scope=staff&limit=1'));

  // Where this account is signed in. Best-effort: a Clerk hiccup costs the
  // device list, not the whole page — and the tab says it did not load rather
  // than vanishing as if there were nothing to show.
  const sessionsLoad: Outcome<{ sessions: ActiveSession[] }> =
    me === null
      ? { state: 'ok', data: { sessions: [] } }
      : await outcome(apiFetch<{ sessions: ActiveSession[] }>('/me/sessions'));
  const sessions = sessionsLoad.state === 'ok' ? sessionsLoad.data.sessions : [];

  const membership = me?.memberships[0] ?? null;

  /*
   * Exactly one owner per tenant, so this is a fact rather than a judgement.
   * Read from the membership the API already resolved — never from a role the
   * client could have asked for.
   */
  const isOwner = membership?.roles.includes('owner') === true;
  // The avatar's warning, said again on the card it leads to (Rui, 28-10-2026).
  const subscriptionWarning = isOwner
    ? await apiFetch<SubscriptionAlertView>('/subscription/alert').catch(() => null)
    : null;

  // Whole days remaining, rounded up, so the last day reads "1 day left" rather
  // than "0". Information only — nothing is enforced until phase 2.
  const trialDaysLeft =
    membership?.trialEndsAt == null
      ? null
      : Math.ceil((new Date(membership.trialEndsAt).getTime() - Date.now()) / 86_400_000);

  const target = backTarget(from, '/dashboard');
  const back = { href: target.href, label: t(target.labelKey) };

  if (me === null) {
    return (
      <PageShell title={t('profile.title')} subtitle={t('profile.subtitle')} back={back}>
        {failure !== null && (
          <PageError
            message={t(failure.key)}
            {...(failure.detail === '' ? {} : { detail: failure.detail })}
          />
        )}
      </PageShell>
    );
  }

  const account = me;

  return (
    <DetailPage
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      back={back}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <>
              <section className="rounded border border-border bg-surface p-5">
                {/*
                  The same ID square as the student and staff records — round 5.
                  Clerk holds an avatar for anybody who signed in with one, and
                  this is where a person would replace it; it waits on the same
                  object storage everything else does, and says so.
                */}
                <div className="flex flex-wrap items-start gap-5">
                  <PhotoUpload
                    variant="id"
                    label={t('students.photoUpload')}
                    reason={t('students.photoNoStorage')}
                  />
                  <div className="min-w-0 flex-1 basis-64">
                    <ProfileForm me={account} />
                  </div>
                </div>
              </section>

              {membership !== null && <MessagePreferenceCard clubName={membership.organizationName} />}

              {/*
                Subscrição lives here — 13 September 2026. What Poolse charges
                the club is the owner's own business, like their card and their
                renewal date. **Owner only**, and the endpoint refuses everybody
                else regardless of how they arrived — this link is a courtesy,
                not the control. A link rather than the screen itself, so three
                price cards do not bury the rest.
              */}
              {isOwner && (
                <section className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded border border-border bg-surface p-5">
                  <div>
                    <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                      {t('subscription.title')}
                    </h2>
                    <p className="mt-1 text-sm text-foreground-muted">{t('subscription.subtitle')}</p>
                    {subscriptionWarning?.alert != null && (
                      <p className="mt-2 flex items-start gap-2 text-sm text-warning">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {subscriptionAlertSentence(t, subscriptionWarning.alert)}
                      </p>
                    )}
                  </div>
                  <FromLink
                    href="/dashboard/profile/subscription"
                    className="inline-flex h-control items-center justify-center px-4 text-control gap-2 shrink-0 rounded border border-border hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('subscription.open')}
                  </FromLink>
                </section>
              )}

              {membership !== null &&
                membership.subscriptionStatus === 'trialing' &&
                trialDaysLeft !== null && (
                  <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded border border-border bg-surface-muted px-5 py-3">
                    <span className="text-sm font-medium">
                      {t('dashboard.trial')} —{' '}
                      {trialDaysLeft > 0
                        ? t('dashboard.trialDaysLeft', { days: trialDaysLeft })
                        : t('dashboard.trialEnded')}
                    </span>
                    <span className="text-sm text-foreground-muted">{t('dashboard.trialNoCard')}</span>
                  </section>
                )}

              {membership !== null && (
                <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('account.title')}
                  </h2>

                  <dl className="flex flex-wrap gap-x-10 gap-y-4">
                    <div className="flex flex-col">
                      <dt className="text-sm text-foreground-muted">{t('dashboard.organization')}</dt>
                      <dd className="mt-1 font-medium">{membership.organizationName}</dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-sm text-foreground-muted">{t('dashboard.yourRoles')}</dt>
                      <dd className="mt-1 flex flex-wrap gap-1">
                        {membership.roles.length === 0 ? (
                          <span className="text-sm text-foreground-muted">{t('account.noRoles')}</span>
                        ) : (
                          membership.roles.map((role) => (
                            <span
                              key={role}
                              className="rounded bg-primary/15 px-2 py-0.5 text-sm text-primary"
                            >
                              {t(`roles.${role}`)}
                            </span>
                          ))
                        )}
                      </dd>
                    </div>
                  </dl>
                </section>
              )}
            </>
          ),
        },
        {
          slug: 'organizations',
          labelKey: 'account.organizations',
          visible: account.memberships.length > 1,
          badge: { kind: 'count', value: account.memberships.length },
          content: () => (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('account.organizations')}
              </h2>
              <ul className="flex flex-col gap-2">
                {account.memberships.map((other) => (
                  <li key={other.membershipId} className="text-sm">
                    {other.organizationName}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-foreground-muted">
                {t('dashboard.multipleOrganizations')}
              </p>
            </section>
          ),
        },
        {
          slug: 'sessions',
          labelKey: 'sessions.title',
          visible: sessions.length > 0 || sessionsLoad.state === 'failed',
          content: () => (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('sessions.title')}
              </h2>
              {sessionsLoad.state === 'failed' && (
                <PageError message={t(sessionsLoad.failure.key)} />
              )}
              <Sessions
                sessions={sessions}
                formatted={sessions.map((session) => ({
                  id: session.id,
                  started: formatStamp(new Date(session.createdAt)),
                  lastActive: formatStamp(new Date(session.lastActiveAt)),
                }))}
              />
            </section>
          ),
        },
        {
          slug: 'transfer',
          labelKey: 'transfer.title',
          visible:
            (people.state === 'ok' && people.data.canTransferOwnership) ||
            (people.state === 'failed' && isOwner),
          content: () => (
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('transfer.title')}
              </h2>
              {people.state === 'failed' && <PageError message={t(people.failure.key)} />}
              {people.state === 'ok' && (
                <>
                  <p className="text-sm text-foreground-muted">{t('transfer.explain')}</p>
                  {/*
                    Every admin, from its own query — not from a page of the
                    members list, which would have offered only the admins who
                    happened to land on page 1 — POOLSE-29.
                  */}
                  <TransferOwnership
                    organizationId={people.data.organizationId}
                    candidates={people.data.transferCandidates}
                  />
                </>
              )}
            </section>
          ),
        },
        {
          // POOLSE-79. The Owner's alone, like the subscription: the club's
          // decision about its own data. Not offered to a support session,
          // which is an Admin, and refused by the API to anybody else.
          slug: 'support',
          labelKey: 'support.tab',
          visible: isOwner,
          content: async () => {
            const loaded = await loadSupportAccess();
            if (loaded.state !== 'ok') {
              return (
                <PageError
                  message={t(loaded.state === 'failed' ? loaded.failure.key : 'common.notAllowed')}
                />
              );
            }
            return <SupportAccess {...loaded.data} />;
          },
        },
      ]}
    />
  );
}
