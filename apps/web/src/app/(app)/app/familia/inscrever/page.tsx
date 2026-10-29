import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { apiFetch, type AppJoinOptions } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { describeLoad } from '@/lib/load-failure';
import { JoinForm } from './join-form';

/**
 * Asking to join a class — POOLSE-121, the enrolment half (Rui, 29-10-2026).
 *
 * For one of the reader's own people, or a new child: every turma of the season
 * with a free place, the child's level first. Nothing is enrolled here — the
 * request goes to the club's Pedidos de inscrição, which decides. Under the form,
 * the requests already sent and where each one stands.
 */
export default async function JoinClass(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let options: AppJoinOptions;
  try {
    options = await apiFetch<AppJoinOptions>('/app/enrolment-requests');
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  return (
    <>
      <Link
        href="/app/familia"
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 coarse:pr-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('app.family.backToAgenda')}
        <LinkBusy />
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{t('app.join.title')}</h1>
      <p className="text-sm text-foreground-muted">{t('app.join.intro')}</p>

      <JoinForm
        options={options}
        consent={t('leads.public.consent', { club: options.clubName, months: options.retentionMonths })}
      />

      {options.sent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('app.join.sentTitle')}
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {options.sent.map((one) => (
              <li key={one.id} className="flex flex-col gap-0.5 p-3 text-sm">
                <span className="font-medium">
                  {one.swimmerName}
                  {one.className !== null && <span className="font-normal"> · {one.className}</span>}
                </span>
                <span className="text-foreground-muted">
                  {t(`app.join.state.${one.status}`)} · {formatDate(new Date(one.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
