import { redirect } from 'next/navigation';
import { CompetitionPage, sectionPath } from './competition-page';

/**
 * Competição → Provas. An old `?section=minimos` or `?section=escaloes` link —
 * from before the parts had their own routes — lands where it meant to.
 */
export default async function MeetsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; section?: string; season?: string; from?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  if (params.section === 'minimos' || params.section === 'escaloes') {
    const season = params.season === undefined ? '' : `?season=${encodeURIComponent(params.season)}`;
    redirect(`${sectionPath(params.section)}${season}`);
  }
  return <CompetitionPage section="meets" params={params} />;
}
