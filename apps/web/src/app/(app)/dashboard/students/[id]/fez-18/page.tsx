import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { apiFetch, type MajorityState } from '@/lib/api';
import { backTarget } from '@/lib/back';
import { formatDate, formatStamp } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { PageError, PageShell } from '@/components/page-shell';
import { MajorityActions } from '../majority-actions';

/**
 * One student's *Fez 18 anos* — POOLSE-213 (Rui, 10-11-2026), opened from the
 * button beside *Dados de saúde* on their *Geral*, which shows only once the
 * student has come of age with (or after) a parent's link.
 *
 * While unanswered: when they came of age, whose link stopped granting, what
 * changed, and the three actions (POOLSE-207's, unchanged). Answered: each
 * decision in words, who took it and when. Owner and admin, as the API is.
 */
export default async function StudentMajorityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const { from } = await searchParams;
  const target = backTarget(from, `/dashboard/students/${id}`);
  const back = { href: target.href, label: t(target.labelKey) };
  const loaded = await outcome(apiFetch<MajorityState>(`/students/${id}/majority`));

  if (loaded.state === 'failed' && loaded.status === 404) notFound();
  if (loaded.state === 'refused') {
    return (
      <PageShell title={t('majority.title')} back={back}>
        <section className="rounded bg-surface p-5 shadow-card">
          <p className="font-medium">{t('majority.notPermitted')}</p>
        </section>
      </PageShell>
    );
  }
  if (loaded.state === 'failed') {
    return (
      <PageShell title={t('majority.title')} back={back}>
        <PageError message={t(loaded.failure.key)} detail={loaded.failure.detail} />
      </PageShell>
    );
  }

  const { pending, decisions } = loaded.data;
  return (
    <PageShell title={t('majority.title')} subtitle={t('majority.studentSubtitle')} back={back}>
      {pending !== null && (
        <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
          <div className="flex flex-col gap-1">
            <p className="font-medium">{pending.name}</p>
            <p className="text-sm text-foreground-muted">
              {t('majority.cameOfAge', { date: formatDate(pending.majorityOn) })}
            </p>
            {pending.parents.length > 0 && (
              <p className="text-sm">
                {t('majority.parents', {
                  names: pending.parents
                    .map((parent) => (parent.relationship === null ? parent.name : `${parent.name} (${parent.relationship})`))
                    .join(', '),
                })}
              </p>
            )}
            <p className="text-sm text-foreground-muted">{t('majority.whatChanged')}</p>
          </div>
          <MajorityActions studentId={pending.studentId} name={pending.name} invitable={pending.invitable} />
        </section>
      )}

      {decisions.length > 0 && (
        <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
          <h2 className="text-sm font-medium">{t('majority.decisionsTitle')}</h2>
          <ul className="flex flex-col divide-y divide-border">
            {decisions.map((one) => (
              <li key={`${one.majorityOn}${one.reviewedAt}`} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <span>{t(`majority.decided.${one.action}`)}</span>
                <span className="text-sm text-foreground-muted">
                  {t('majority.decidedBy', {
                    who: one.reviewedBy,
                    when: formatStamp(one.reviewedAt),
                    date: formatDate(one.majorityOn),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending === null && decisions.length === 0 && (
        <section className="rounded bg-surface p-5 shadow-card">
          <p className="text-sm text-foreground-muted">{t('majority.nothingDecided')}</p>
        </section>
      )}
    </PageShell>
  );
}
