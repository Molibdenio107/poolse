import { FromLink } from '@/components/from-link';
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
import { backProp, originBack } from '@/lib/back';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { QualificationStatus } from '@/components/qualification-status';
import { FileUpload } from '@/components/file-upload';
import { Paperclip } from 'lucide-react';
import { storageConfigured } from '@/lib/storage-status';
import { cn } from '@/lib/utils';
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
 *
 * **Each row carries its certificate** — POOLSE-97. A 📎 that downloads it
 * through `/files/:id` (the file's own read rule, no new path), or *Anexar*,
 * which is the person page's own upload and so the same attach-once rule. An
 * *em falta* row has no record to carry one and shows neither. *Sem
 * certificado* narrows the list on the server, before it is paged.
 */
export default async function QualificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; section?: string; from?: string; certificate?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam, section, from, certificate } = await searchParams;
  const withoutCertificate = certificate === 'missing';
  const storageReady = await storageConfigured();
  const back = originBack(from);
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
        `/qualifications/expiring?${new URLSearchParams({
          ...(page > 1 ? { page: String(page) } : {}),
          ...(withoutCertificate ? { certificate: 'missing' } : {}),
        })}`,
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
    redirect(
      pageHref(
        base,
        { certificate: withoutCertificate ? 'missing' : undefined },
        lastPage(list.total, list.limit),
      ),
    );
  }

  return (
    <PageShell
      title={t('qualifications.title')}
      subtitle={t('qualifications.subtitle')}
      back={backProp(back, t)}
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
              href: sectionHref(base, { from }, 'attention'),
              // The whole list's size; a filtered total here would read as the list shrinking.
              count: withoutCertificate ? undefined : list.total,
            },
            { key: 'types', label: t('qualifications.section.types'), href: sectionHref(base, { from }, 'types') },
          ]}
        />
      )}

      {list !== null && current === 'attention' && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">{t('qualifications.attention')}</h2>
            {/* All, or only the records with no certificate on file — POOLSE-97. */}
            <nav aria-label={t('qualifications.certificate.filterLabel')} className="flex flex-wrap gap-2">
              {([false, true] as const).map((only) => (
                <FromLink
                  key={String(only)}
                  href={`${base}?${new URLSearchParams({
                    section: 'attention',
                    ...(only ? { certificate: 'missing' } : {}),
                  })}`}
                  aria-current={only === withoutCertificate ? 'page' : undefined}
                  scroll={false}
                  className={cn(
                    'inline-flex h-control items-center justify-center rounded px-4 text-control',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    only === withoutCertificate
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border hover:bg-surface-muted',
                  )}
                >
                  {t(only ? 'qualifications.certificate.missingFilter' : 'qualifications.certificate.allFilter')}
                </FromLink>
              ))}
            </nav>
          </div>
          {list.total === 0 ? (
            <p className="text-sm text-foreground-muted">
              {withoutCertificate ? t('qualifications.certificate.noneMissing') : t('qualifications.allGreen')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {list.items.map((row) => (
                <li
                  key={`${row.membershipId}-${row.typeId}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                >
                  <span className="flex flex-col">
                    <FromLink
                      href={`/dashboard/facilities/staff/${row.membershipId}?tab=qualifications`}
                      className="font-medium underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {row.personName ?? t('qualifications.unnamed')}
                    </FromLink>
                    <span className="text-sm text-foreground-muted">{row.typeName}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <QualificationStatus status={row.status} expiresOn={row.expiresOn} />
                    {row.documentFileId !== null ? (
                      // Through the app, never a bucket link; `download` keeps its name.
                      <a
                        href={`/files/${row.documentFileId}`}
                        download={row.documentName ?? true}
                        aria-label={t('qualifications.certificate.downloadLabel', {
                          name: row.personName ?? t('qualifications.unnamed'),
                          type: row.typeName,
                        })}
                        className="inline-flex items-center gap-1.5 rounded text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        <Paperclip aria-hidden className="size-4" />
                        {t('qualifications.certificate.download')}
                      </a>
                    ) : (
                      row.qualificationId !== null && (
                        <FileUpload
                          target={`qualification:${row.qualificationId}`}
                          label={t('qualifications.certificate.attach')}
                          ariaLabel={t('qualifications.certificate.attachLabel', {
                            name: row.personName ?? t('qualifications.unnamed'),
                            type: row.typeName,
                          })}
                          unavailable={storageReady ? null : t('files.notConfigured')}
                        />
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            page={list}
            basePath={base}
            query={{ section, from, certificate: withoutCertificate ? 'missing' : undefined }}
          />
        </section>
      )}

      {types !== null && current === 'types' && (
        <TypesPanel organizationId={organizationId} types={types.types} amberDays={types.amberDays} />
      )}
    </PageShell>
  );
}
