import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type AppAgenda } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { FeeStatus } from '../agenda-parts';

/**
 * *Pagamentos* — POOLSE-136. The fee status the agenda used to carry, moved
 * here and not rebuilt: the same `/app/agenda` read, the same `FeeStatus`,
 * read-only, with where to pay. Nothing new is fetched.
 */
export default async function FamilyPayments(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let agenda: AppAgenda;
  try {
    agenda = await apiFetch<AppAgenda>('/app/agenda');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const fees = await FeeStatus({ children: agenda.children });

  return (
    <>
      <h1>{t('app.tabs.familia.pagamentos')}</h1>
      {fees ?? <p className="text-foreground-muted">{t('app.family.noFees')}</p>}
    </>
  );
}
