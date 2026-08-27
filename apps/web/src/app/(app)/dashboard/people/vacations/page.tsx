import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type MyVacations as MyVacationsData,
  type PendingVacations,
  type TeamVacations,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { ApprovalQueue } from './approval-queue';
import { MyVacations } from './my-vacations';
import { TeamMap } from './team-map';
import { PageShell } from '@/components/page-shell';

/**
 * Férias — backlog round 3, stories 6, 7 and 8.
 *
 * Three tabs, and they are plain links rather than client-side state. Which
 * means each has its own URL: bookmarkable, shareable, workable with the
 * browser's back button — the same reasoning as the calendar's week links next
 * door. A manager who lives in the approval queue can keep it open.
 *
 * The year is in the URL for the same reason, and because "show me last year" is
 * a question somebody asks once a year and then wants to send to somebody else.
 */
type Tab = 'mine' | 'queue' | 'team';

function isTab(value: string | undefined): value is Tab {
  return value === 'mine' || value === 'queue' || value === 'team';
}

export default async function VacationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; year?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { tab: rawTab, year: rawYear } = await searchParams;

  const tab: Tab = isTab(rawTab) ? rawTab : 'mine';
  const year = Number(rawYear);
  const chosenYear =
    Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();

  let mine: MyVacationsData | null = null;
  let queue: PendingVacations | null = null;
  let team: TeamVacations | null = null;
  let failure: string | null = null;
  let notPermitted = false;

  try {
    // `mine` is always fetched: it is the only call everybody is allowed to
    // make, and it carries `canApprove`, which is what decides whether the other
    // two tabs exist at all.
    mine = await apiFetch<MyVacationsData>(`/vacations/mine?year=${chosenYear}`);

    if (tab === 'queue' && mine.canApprove) {
      queue = await apiFetch<PendingVacations>('/vacations/pending');
    }
    if (tab === 'team' && mine.canApprove) {
      team = await apiFetch<TeamVacations>(`/vacations/team?year=${chosenYear}`);
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'forbidden_role') notPermitted = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  // Someone who is not an owner or admin typing ?tab=team gets the refusal in
  // words, not a blank panel — the same rule as People.
  const refused = notPermitted || (tab !== 'mine' && mine?.canApprove === false);

  // Three years back is enough for "what did I take last year" without turning
  // the control into a scrolling list.
  const currentYear = new Date().getFullYear();
  const years = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  return (
    <PageShell
      title={t('vacations.title')}
      subtitle={t('vacations.subtitle')}
      back={{ href: "/dashboard/people", label: t('vacations.backToPeople') }}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {mine !== null && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <nav aria-label={t('vacations.tabs')} className="flex flex-wrap gap-2">
              <TabLink
                tab="mine"
                current={tab}
                year={chosenYear}
                label={t('vacations.mine')}
              />
              {mine.canApprove && (
                <>
                  <TabLink
                    tab="queue"
                    current={tab}
                    year={chosenYear}
                    label={t('vacations.queue')}
                  />
                  <TabLink
                    tab="team"
                    current={tab}
                    year={chosenYear}
                    label={t('vacations.teamMap')}
                  />
                </>
              )}
            </nav>

            {/*
              The queue has no year — it is whatever is waiting now — so the
              picker would be a control that changed nothing.
            */}
            {tab !== 'queue' && (
              <nav aria-label={t('vacations.yearNav')} className="flex flex-wrap gap-1">
                {years.map((option) => (
                  <Link
                    key={option}
                    href={`/dashboard/people/vacations?tab=${tab}&year=${option}`}
                    aria-current={option === chosenYear ? 'page' : undefined}
                    className={cn(
                      'rounded border px-3 py-1.5 text-sm transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      option === chosenYear
                        ? 'border-primary bg-primary/15 font-medium text-primary'
                        : 'border-border hover:border-primary/50 hover:text-primary',
                    )}
                  >
                    {option}
                  </Link>
                ))}
              </nav>
            )}
          </div>

          {refused ? (
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <p className="font-medium">{t('vacations.restricted')}</p>
              <p className="text-sm text-foreground-muted">{t('vacations.restrictedHint')}</p>
            </section>
          ) : (
            <>
              {tab === 'mine' && <MyVacations data={mine} />}
              {tab === 'queue' && queue !== null && <ApprovalQueue data={queue} />}
              {tab === 'team' && team !== null && <TeamMap data={team} />}
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

function TabLink({
  tab,
  current,
  year,
  label,
}: {
  tab: Tab;
  current: Tab;
  year: number;
  label: string;
}): React.ReactElement {
  const active = tab === current;

  return (
    <Link
      href={`/dashboard/people/vacations?tab=${tab}&year=${year}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded px-3 py-2 text-sm transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        active
          ? 'bg-primary/15 font-medium text-primary'
          : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}
