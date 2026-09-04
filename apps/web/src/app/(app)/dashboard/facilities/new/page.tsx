import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { apiFetch, type Facilities } from '@/lib/api';
import { CreateFacilityForm } from '../facility-forms';
import { PageError, PageShell } from '@/components/page-shell';

/**
 * A new site.
 *
 * On its own screen rather than as a panel above the list, and for the same
 * reason the turma form moved: the list is the thing an operator looks at every
 * day, and a create form parked at the top of it is a form they read past every
 * day. Adding a site is a once-a-year job.
 */
export default async function NewFacilityPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let data: Facilities | null = null;
  let failure: LoadFailure | null = null;

  try {
    data = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    failure = describeLoad(error);
  }

  return (
    <PageShell
      title={t('facilities.addSite')}
      subtitle={t('facilities.addSiteHint')}
      back={{ href: "/dashboard/facilities", label: t('facilities.backToSites') }}
    >


      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && !data.canManage && (
        <p className="text-sm text-foreground-muted">{t('facilities.readOnly')}</p>
      )}

      {data !== null && data.canManage && (
        <section className="rounded border border-border bg-surface p-5">
          <CreateFacilityForm organizationId={data.organizationId} timezones={data.timezones} />
        </section>
      )}
    </PageShell>
  );
}
