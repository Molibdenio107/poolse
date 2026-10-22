import { CompetitionPage } from '../competition-page';

/** Competição → Escalões. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; from?: string }>;
}): Promise<React.ReactElement> {
  return <CompetitionPage section="escaloes" params={await searchParams} />;
}
