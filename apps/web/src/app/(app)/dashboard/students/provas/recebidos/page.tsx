import { CompetitionPage } from '../competition-page';

/** Competição → Recebidos por email — POOLSE-114. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; from?: string }>;
}): Promise<React.ReactElement> {
  return <CompetitionPage section="recebidos" params={await searchParams} />;
}
