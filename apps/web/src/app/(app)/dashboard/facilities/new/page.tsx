import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Facilities } from '@/lib/api';
import { CreateFacilityForm } from '../facility-forms';

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
  let failure: string | null = null;

  try {
    data = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t('facilities.addSite')}</h1>
        <p className="text-foreground-muted">{t('facilities.addSiteHint')}</p>
      </header>

      <Link
        href="/dashboard/facilities"
        className="self-start text-sm text-primary hover:underline"
      >
        {t('facilities.backToSites')}
      </Link>

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && !data.canManage && (
        <p className="text-sm text-foreground-muted">{t('facilities.readOnly')}</p>
      )}

      {data !== null && data.canManage && (
        <section className="rounded border border-border bg-surface p-5">
          <CreateFacilityForm organizationId={data.organizationId} timezones={data.timezones} />
        </section>
      )}
    </main>
  );
}
