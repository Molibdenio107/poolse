import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Siren } from 'lucide-react';
import { apiFetch, type IncidentFacts } from '@/lib/api';
import { isMissing, outcome } from '@/lib/load-failure';
import { formatStamp } from '@/lib/date-format';
import { PageError, PageShell } from '@/components/page-shell';
import { ClinicalDetail } from './clinical-detail';
import { ArchiveIncident } from './archive-incident';

/**
 * One incident — POOLSE-70, slice 1.
 *
 * The facts are drawn on load, for any member of staff. The clinical detail is
 * not: it is fetched by a button, because every decrypting read writes an audit
 * row and a page that read it on render would log every refresh as a reading.
 *
 * The addenda are listed in order with who and when; their words are part of
 * the detail and arrive with it. Nothing on this page edits the original —
 * a correction is a new addendum, and the page says so.
 *
 * Exempt from paging (CONVENTIONS): one incident's addenda are a handful of
 * corrections, and a partial list of them is not the record.
 */
export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;

  const loaded = await outcome(apiFetch<IncidentFacts>(`/incidents/${encodeURIComponent(id)}`));
  // A 400 is a malformed id (ParseUUIDPipe): there is no such incident either.
  if (isMissing(loaded) || (loaded.state === 'failed' && loaded.status === 400)) notFound();

  if (loaded.state !== 'ok') {
    return (
      <PageShell
        title={t('incidents.title')}
        back={{ href: '/dashboard/facilities/incidents', label: t('incidents.backToList') }}
      >
        {loaded.state === 'failed' && (
          <PageError
            message={t(loaded.failure.key)}
            {...(loaded.failure.detail === '' ? {} : { detail: loaded.failure.detail })}
          />
        )}
      </PageShell>
    );
  }

  const incident = loaded.data;
  const listHref = `/dashboard/facilities/incidents?site=${incident.facilityId}`;

  return (
    <PageShell
      title={t('incidents.oneTitle', { when: formatStamp(incident.occurredAt) })}
      subtitle={incident.facilityName}
      back={{ href: listHref, label: t('incidents.backToList') }}
      actions={
        incident.canArchive && !incident.archived ? (
          <ArchiveIncident incidentId={incident.id} listHref={listHref} />
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        {incident.archived && (
          <p className="rounded border border-border bg-surface-muted p-3 text-sm">
            {t('incidents.archivedNote')}
          </p>
        )}

        <section
          aria-labelledby="incident-facts"
          className="flex flex-col gap-3 rounded border border-border bg-surface p-5"
        >
          <h2 id="incident-facts" className="font-medium">
            {t('incidents.factsTitle')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-foreground-muted">{t('incidents.field.occurredAt')}</dt>
            <dd>{formatStamp(incident.occurredAt)}</dd>

            <dt className="text-foreground-muted">{t('incidents.field.place')}</dt>
            <dd>{incident.placeName ?? t('incidents.elsewhere')}</dd>

            <dt className="text-foreground-muted">{t('incidents.field.person')}</dt>
            <dd>
              {incident.personName}
              <span className="text-foreground-muted">
                {' · '}
                {t(`incidents.personKind.${incident.personKind}`)}
              </span>
            </dd>

            <dt className="text-foreground-muted">{t('incidents.field.emergencyServices')}</dt>
            <dd>
              {incident.emergencyCalled ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-danger">
                  <Siren aria-hidden className="size-4" />
                  {t('incidents.emergencyCalled')}
                </span>
              ) : (
                t('incidents.emergencyNotCalled')
              )}
            </dd>

            <dt className="text-foreground-muted">{t('incidents.field.lifeguard')}</dt>
            <dd>{incident.lifeguardName ?? t('incidents.noLifeguardNamed')}</dd>

            <dt className="text-foreground-muted">{t('incidents.field.policyReference')}</dt>
            <dd>{incident.policyReference ?? t('incidents.noPolicyReference')}</dd>

            <dt className="text-foreground-muted">{t('incidents.field.recordedBy')}</dt>
            <dd>
              {t('incidents.recordedByAt', {
                name: incident.recordedByName ?? t('incidents.unknownPerson'),
                at: formatStamp(incident.createdAt),
              })}
            </dd>
          </dl>
        </section>

        <section
          aria-labelledby="incident-addenda"
          className="flex flex-col gap-3 rounded border border-border bg-surface p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 id="incident-addenda" className="font-medium">
              {t('incidents.addendaTitle')}
            </h2>
            <p className="text-sm text-foreground-muted">{t('incidents.neverEdited')}</p>
          </div>
          {incident.addenda.length === 0 ? (
            <p className="text-sm">{t('incidents.noAddenda')}</p>
          ) : (
            <ol className="flex flex-col gap-1 text-sm">
              {incident.addenda.map((addendum, index) => (
                <li key={addendum.id}>
                  {t('incidents.addendumLine', {
                    number: index + 1,
                    name: addendum.writtenByName ?? t('incidents.unknownPerson'),
                    at: formatStamp(addendum.createdAt),
                  })}
                </li>
              ))}
            </ol>
          )}
        </section>

        <ClinicalDetail incidentId={incident.id} canRead={incident.canReadDetail} />
      </div>
    </PageShell>
  );
}
