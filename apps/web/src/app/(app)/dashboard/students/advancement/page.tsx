import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Me,
  type Paginated,
  type TransferProposal,
} from '@/lib/api';
import { PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { ProposalCard } from './proposal-card';

/**
 * The advancement queue — POOLSE-19, criterion 4.
 *
 * The screen the whole feature exists for. Before it, a student finished their
 * level and sat there until somebody reviewed the turma by hand; now finishing
 * puts them here, and the work is confirming rather than noticing.
 *
 * Staff only, refused by the API as well as hidden here — criterion 7 says a
 * human confirms, and a Student or encarregado is not that human.
 */
export default async function AdvancementPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam } = await searchParams;
  const page = readPage(pageParam);

  let proposals: Paginated<TransferProposal> | null = null;
  let organizationId = '';
  let failure: string | null = null;
  let notPermitted = false;

  try {
    const [queue, me] = await Promise.all([
      apiFetch<{ proposals: Paginated<TransferProposal> }>(
        `/transfer-proposals${page > 1 ? `?page=${page}` : ''}`,
      ),
      apiFetch<Me>('/me'),
    ]);
    proposals = queue.proposals;
    organizationId = me.memberships[0]?.organizationId ?? '';
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  if (proposals !== null && isPastEnd(page, proposals.total, proposals.limit)) {
    redirect(
      pageHref('/dashboard/students/advancement', {}, lastPage(proposals.total, proposals.limit)),
    );
  }

  return (
    <PageShell
      title={t('advancement.title')}
      subtitle={t('advancement.subtitle')}
      back={{ href: '/dashboard/students', label: t('students.backToRegister') }}
    >
      {notPermitted && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <p className="font-medium">{t('advancement.notPermitted')}</p>
          <p className="text-sm text-foreground-muted">{t('advancement.notPermittedHint')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {proposals !== null && proposals.total === 0 && (
        <section className="flex flex-col gap-1 rounded border border-border bg-surface p-5">
          <p>{t('advancement.none')}</p>
          {/*
            An empty queue is the normal state, not a problem. The hint says so,
            because an empty screen with no explanation reads as broken.
          */}
          <p className="text-sm text-foreground-muted">{t('advancement.noneHint')}</p>
        </section>
      )}

      {proposals !== null && proposals.total > 0 && (
        <>
          <ul className="flex flex-col gap-4">
            {proposals.items.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                organizationId={organizationId}
                proposal={proposal}
              />
            ))}
          </ul>

          <Pagination page={proposals} basePath="/dashboard/students/advancement" />
        </>
      )}
    </PageShell>
  );
}
