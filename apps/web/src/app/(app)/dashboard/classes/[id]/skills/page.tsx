import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type TurmaSkills } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { SkillsGrid } from './skills-grid';
import { PageShell } from '@/components/page-shell';

/**
 * Competências — POOLSE-20.
 *
 * Its own screen rather than a panel on the turma page, because it is what an
 * instructor opens *during* a lesson, on a phone, with one hand. Everything else
 * about a turma is administration done sitting down.
 */
export default async function SkillsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;

  let data: TurmaSkills | null = null;
  let failure: string | null = null;

  try {
    data = await apiFetch<TurmaSkills>(`/skills/turma/${id}`);
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <PageShell
      title={t('skills.title')}
      subtitle={data === null
            ? t('skills.subtitle')
            : [data.className, data.levelName].filter(Boolean).join(' · ')}
    >
      <BackLink href={`/dashboard/classes/${id}`} label={t('skills.backToClass')} />


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && <SkillsGrid data={data} />}
    </PageShell>
  );
}
