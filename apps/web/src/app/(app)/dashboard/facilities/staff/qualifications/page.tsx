import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type ExpiringQualification,
  type Me,
  type Paginated,
  type QualificationTypes,
} from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { QualificationStatus } from '@/components/qualification-status';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';
import { TypesPanel } from './types-panel';

/**
 * Qualificações — POOLSE-27, 7b.2.
 *
 * Everybody âmbar, vermelho or em falta, worst first, so the office renews
 * before the date rather than after it. Paginated: it grows with the staff.
 * Beside it, under its own pill, the club's types and its âmbar window —
 * tenant data, in the club's own words. One section at a time (12 October
 * 2026): the list is what the office opens this for, and the types are set up
 * once. The types are fetched only when that section is open.
 *
 * Owner and admin, refused by the API as well as hidden from the menu.
 */
export default async function QualificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; section?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam, section } = await searchParams;
  const page = readPage(pageParam);
  const current = pickSection(['attention', 'types'] as const, section, 'attention');

  let list: Paginated<ExpiringQualification> | null = null;
  let types: QualificationTypes | null = null;
  let organizationId = '';
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    const [loadedList, loadedTypes, me] = await Promise.all([
      apiFetch<Paginated<ExpiringQualification>>(
        `/qualifications/expiring${page > 1 ? `?page=${page}` : ''}`,
      ),
      current === 'types' ? apiFetch<QualificationTypes>('/qualification-types') : null,
      current === 'types' ? apiFetch<Me>('/me') : null,
    ]);
    list = loadedList;
    types = loadedTypes;
    organizationId = me?.memberships[0]?.organizationId ?? '';
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  const base = '/dashboard/facilities/staff/qualifications';
  if (list !== null && isPastEnd(page, list.total, list.limit)) {
    redirect(pageHref(base, {}, lastPage(list.total, list.limit)));
  }

  return (
    <PageShell
      title={t('qualifications.title')}
      subtitle={t('qualifications.subtitle')}
      back={{ href: '/dashboard/facilities/staff', label: t('staff.backToStaff') }}
    >
      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('staff.recordRestricted')}</p>
        </section>
      )}

      {failure !== null && <PageError message={t(failure.key)} detail={failure.detail} />}

      {list !== null && (
        <SectionPills
          label={t('qualifications.section.nav')}
          current={current}
          items={[
            {
              key: 'attention',
              label: t('qualifications.attention'),
              href: sectionHref(base, {}, 'attention'),
              count: list.total,
            },
            { key: 'types', label: t('qualifications.section.types'), href: sectionHref(base, {}, 'types') },
          ]}
        />
      )}

      {list !== null && current === 'attention' && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('qualifications.attention')}</h2>
          {list.total === 0 ? (
            <p className="text-sm text-foreground-muted">{t('qualifications.allGreen')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {list.items.map((row) => (
                <li
                  key={`${row.membershipId}-${row.typeId}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                >
                  <span className="flex flex-col">
                    <Link
                      href={`/dashboard/facilities/staff/${row.membershipId}?tab=qualifications`}
                      className="font-medium underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {row.personName ?? t('qualifications.unnamed')}
                    </Link>
                    <span className="text-sm text-foreground-muted">{row.typeName}</span>
                  </span>
                  <QualificationStatus status={row.status} expiresOn={row.expiresOn} />
                </li>
              ))}
            </ul>
          )}
          <Pagination page={list} basePath={base} />
        </section>
      )}

      {types !== null && current === 'types' && (
        <TypesPanel organizationId={organizationId} types={types.types} amberDays={types.amberDays} />
      )}
    </PageShell>
  );
}
