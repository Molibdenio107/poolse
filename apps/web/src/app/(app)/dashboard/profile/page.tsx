import { getFormatter, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type ActiveSession, type Me, type People } from '@/lib/api';
import { ProfileForm } from './profile-form';
import { TransferOwnership } from './transfer-ownership';
import { Sessions } from '../sessions';
import { PhotoUpload } from '@/components/photo-upload';
import { PageShell } from '@/components/page-shell';

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
 */
export default async function ProfilePage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  let me: Me | null = null;
  let failure: string | null = null;

  try {
    me = await apiFetch<Me>('/me');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  /*
   * Best-effort, and a refusal is not an error here.
   *
   * `GET /people` is owner and admin only; for an instructor it answers 403
   * with `forbidden_role`, which is the API working rather than anything going
   * wrong. This page belongs to everybody, so the whole fetch is wrapped and
   * every failure — refused, offline, no organization yet — lands in the same
   * place: `people` stays null and the page renders without the transfer block.
   * Turning this into an error banner would break the one screen an instructor
   * is guaranteed to be able to open.
   *
   * The smallest page of members the API will give, because nothing here reads
   * the list: the transfer picker gets `transferCandidates`, which is every
   * admin and is not paginated — POOLSE-29.
   */
  let people: People | null = null;
  if (me !== null) {
    try {
      people = await apiFetch<People>('/people?scope=staff&limit=1');
    } catch {
      people = null;
    }
  }

  // Where this account is signed in. Best-effort, as it was on the dashboard: a
  // Clerk hiccup should cost the device list, not the whole page — and this page
  // is the one screen every role is guaranteed to be able to open.
  let sessions: ActiveSession[] = [];
  if (me !== null) {
    try {
      sessions = (await apiFetch<{ sessions: ActiveSession[] }>('/me/sessions')).sessions;
    } catch {
      sessions = [];
    }
  }

  const membership = me?.memberships[0] ?? null;

  // Whole days remaining, rounded up, so the last day reads "1 day left" rather
  // than "0". Information only — nothing is enforced until phase 2.
  const trialDaysLeft =
    membership?.trialEndsAt == null
      ? null
      : Math.ceil((new Date(membership.trialEndsAt).getTime() - Date.now()) / 86_400_000);

  return (
    <PageShell
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      back={{ href: "/dashboard", label: t('common.backToDashboard') }}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {me !== null && (
        <section className="rounded border border-border bg-surface p-5">
          {/*
            The same ID square as the student and staff records — round 5.
            Clerk holds an avatar for anybody who signed in with one, and this is
            where a person would replace it; it waits on the same object storage
            everything else does, and says so.
          */}
          <div className="flex flex-wrap items-start gap-5">
            <PhotoUpload
              variant="id"
              label={t('students.photoUpload')}
              reason={t('students.photoNoStorage')}
            />
            <div className="min-w-0 flex-1">
              <ProfileForm me={me} />
            </div>
          </div>
        </section>
      )}

      {membership !== null && membership.subscriptionStatus === 'trialing' && trialDaysLeft !== null && (
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

      {me !== null && me.memberships.length > 1 && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('account.organizations')}
          </h2>
          <ul className="flex flex-col gap-2">
            {me.memberships.map((other) => (
              <li key={other.membershipId} className="text-sm">
                {other.organizationName}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-foreground-muted">
            {t('dashboard.multipleOrganizations')}
          </p>
        </section>
      )}

      {people !== null && people.canTransferOwnership && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('transfer.title')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('transfer.explain')}</p>
          {/*
            Every admin, from its own query — not from a page of the members
            list. Filtering a page would have offered only the admins who
            happened to land on page 1, and told the owner their colleague was
            not an admin — POOLSE-29.
          */}
          <TransferOwnership
            organizationId={people.organizationId}
            candidates={people.transferCandidates}
          />
        </section>
      )}
      {sessions.length > 0 && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('sessions.title')}
          </h2>
          <Sessions
            sessions={sessions}
            formatted={sessions.map((session) => ({
              id: session.id,
              started: format.dateTime(new Date(session.createdAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
              lastActive: format.dateTime(new Date(session.lastActiveAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            }))}
          />
        </section>
      )}
    </PageShell>
  );
}
