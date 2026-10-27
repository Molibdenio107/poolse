import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, type MaintenanceHome } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { ReportForm } from './report-form';

/** *Reportar* — an avaria or a reposição on an Espaço, from the maintenance home (POOLSE-90 slice 3). */
export default async function ReportIssuePage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  let home: MaintenanceHome;
  try {
    home = await apiFetch<MaintenanceHome>('/app/maintenance');
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }
  return (
    <>
      <Link
        href="/app/manutencao"
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 coarse:pr-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('app.maintenance.backTo')}
        <LinkBusy />
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.maintenance.report')}</h1>
      {home.spaces.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-foreground-muted">
          {t('app.maintenance.noSpaces')}
        </p>
      ) : (
        <ReportForm spaces={home.spaces.map((one) => ({ value: one.id, label: `${one.name} · ${one.facilityName}` }))} />
      )}
    </>
  );
}
