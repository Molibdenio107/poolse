import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch, type QualifyingStandard } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { PageError, PageShell } from '@/components/page-shell';
import { QualifyingImportWizard } from './import-wizard';

/**
 * Importing a standard's entry times from the FPN's table — POOLSE-85, slice 2.
 * Owner, admin and instructor, as typing one is.
 */
export default async function ImportTimesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const t = await getTranslations();
  const loaded = await outcome(apiFetch<QualifyingStandard>(`/qualifying/standards/${id}`));
  if (loaded.state === 'failed' && loaded.status !== 404) {
    return (
      <PageShell title={t('qualifying.import.title')}>
        <PageError message={t(loaded.failure.key)} />
      </PageShell>
    );
  }
  if (loaded.state !== 'ok') notFound();
  const standard = loaded.data;

  return (
    <PageShell
      title={t('qualifying.import.title')}
      subtitle={`${standard.name} · ${standard.seasonName}`}
      back={{ href: `/dashboard/students/provas/minimos/${id}?tab=times`, label: standard.name }}
    >
      {standard.ageGroups.length === 0 ? (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('qualifying.noAgeGroupsYet')}</p>
        </section>
      ) : (
        <QualifyingImportWizard standardId={standard.id} ageGroups={standard.ageGroups} />
      )}
    </PageShell>
  );
}
