import { CompetitionPage } from '../competition-page';

/** Competição → Mínimos. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<React.ReactElement> {
  return <CompetitionPage section="minimos" params={await searchParams} />;
}
