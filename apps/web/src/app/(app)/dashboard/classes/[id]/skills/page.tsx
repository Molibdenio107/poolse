import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { backTarget } from '@/lib/back';
import { apiFetch, type TurmaSkills } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { SkillsGrid } from './skills-grid';
import { PageError, PageShell } from '@/components/page-shell';

/**
 * Competências — POOLSE-20.
 *
 * Its own screen rather than a panel on the turma page, because it is what an
 * instructor opens *during* a lesson, on a phone, with one hand. Everything else
 * about a turma is administration done sitting down.
 */
export default async function SkillsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { from } = await searchParams;
  const { id } = await params;
  const back = backTarget(from, `/dashboard/classes/${id}`);

  let data: TurmaSkills | null = null;
  let failure: LoadFailure | null = null;

  try {
    data = await apiFetch<TurmaSkills>(`/skills/turma/${id}`);
  } catch (error) {
    failure = describeLoad(error);
  }

  return (
    <PageShell
      title={t('skills.title')}
      subtitle={data === null
            ? t('skills.subtitle')
            : [data.className, data.levelName].filter(Boolean).join(' · ')}
    >
      <BackLink href={back.href} label={t(back.labelKey)} />


      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && <SkillsGrid data={data} />}
    </PageShell>
  );
}
