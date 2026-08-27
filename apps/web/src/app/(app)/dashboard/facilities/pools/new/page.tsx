import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Facilities } from '@/lib/api';
import { EntityIcon } from '@/components/entity-icon';
import { PoolForm } from '../../pool-form';
import { PageShell } from '@/components/page-shell';

/**
 * Adding a pool, on its own page.
 *
 * It used to be a row of seven inputs wrapping across the bottom of the
 * facilities list, each labelled only by a placeholder that disappears the
 * moment you type. A pool has enough to describe that it deserves the room.
 *
 * Submitting lands on the new pool's page, where the gallery is.
 */
export default async function NewPoolPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { facilityId = '' } = await searchParams;

  let data: Facilities | null = null;
  let failure: string | null = null;

  try {
    data = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  // The facility comes from the link that got here. Checked against what this
  // organization actually has rather than trusted: a stale link or a hand-edited
  // one must not offer a form that cannot succeed.
  const facility = data?.facilities.find((candidate) => candidate.id === facilityId) ?? null;

  return (
    <PageShell
      title={t('facilities.newPool')}
      subtitle={facility === null ? '' : t('facilities.newPoolAt', { facility: facility.name })}
      back={{ href: "/dashboard/facilities", label: t('facilities.backToFacilities') }}
      actions={<EntityIcon kind="pool" className="size-6 text-primary" />}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && facility === null && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('facilities.pickAFacility')}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {data.facilities.map((candidate) => (
              <li key={candidate.id}>
                <Link
                  href={`/dashboard/facilities/pools/new?facilityId=${candidate.id}`}
                  className="text-primary hover:underline"
                >
                  {candidate.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data !== null && facility !== null && !data.canManage && (
        <p className="text-sm text-foreground-muted">{t('facilities.readOnly')}</p>
      )}

      {data !== null && facility !== null && data.canManage && (
        <section className="rounded border border-border bg-surface p-5">
          <PoolForm
            organizationId={data.organizationId}
            facilityId={facility.id}
            mode="create"
          />
        </section>
      )}
    </PageShell>
  );
}
