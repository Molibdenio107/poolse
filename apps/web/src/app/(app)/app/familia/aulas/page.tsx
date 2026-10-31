import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type AppAgenda, type FamilyLeave } from '@/lib/api';
import { describeLoad, outcome } from '@/lib/load-failure';
import { storageConfigured } from '@/lib/storage-status';
import { PageError } from '@/components/page-shell';
import { FamilyCertificates } from '../certificates';
import { RecentLessons } from '../feedback';
import { ChildFilter } from '../child-filter';

/**
 * *Aulas* — POOLSE-136. What has already happened, moved off the agenda and
 * not rebuilt: *Últimas aulas* to say how they went (POOLSE-116) and the
 * medical certificates the office asked for (POOLSE-109). The same two reads
 * the agenda made; the child chosen on *Início* (`?child=`) carries over.
 */
export default async function FamilyLessons({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { child } = await searchParams;
  const query = child === undefined ? '' : `?child=${encodeURIComponent(child)}`;

  let agenda: AppAgenda;
  try {
    agenda = await apiFetch<AppAgenda>(`/app/agenda${query}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const leaves = await outcome(apiFetch<{ leaves: FamilyLeave[] }>('/app/medical-leave'));
  const storageReady = await storageConfigured();
  const several = agenda.children.length > 1;
  const nameOf = new Map(agenda.children.map((one) => [one.id, one.name]));

  const recent = await RecentLessons({
    recent: agenda.recent,
    names: several && child === undefined ? nameOf : null,
    from: `/app/familia/aulas${query}`,
  });
  const certificates =
    leaves.state === 'ok'
      ? await FamilyCertificates({
          leaves: leaves.data.leaves.filter((leave) => child === undefined || leave.studentId === child),
          names: several ? nameOf : null,
          storageReady,
        })
      : null;

  return (
    <>
      <h1>{t('app.tabs.familia.aulas')}</h1>
      <ChildFilter base="/app/familia/aulas" children={agenda.children} chosen={child} />
      {recent}
      {certificates}
      {leaves.state === 'failed' && <PageError message={t('app.family.certificatesFailed')} />}
      {recent === null && certificates === null && leaves.state !== 'failed' && (
        <p className="text-foreground-muted">{t('app.family.noPastLessons')}</p>
      )}
    </>
  );
}
