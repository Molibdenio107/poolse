import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { formatDate, formatStamp } from '@/lib/date-format';
import { isMissing } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from '@/components/auto-print';
import { exportIncidentAction } from '../../incidents.actions';

/**
 * The insurer's copy of one incident — POOLSE-70 slice 3.
 *
 * A document rather than a screen, like the invoice and the water report: black
 * on white on A4, the browser's "Guardar como PDF" (the PDF pattern of
 * 12 October 2026). It holds everything the record does — the facts, the
 * clinical detail, every addendum in order, and the recorded lifeguard's
 * licence **as it stood on the incident's day**, derived at the moment of export
 * and printed, which is the snapshot the ticket asks for.
 *
 * Rendering it *is* the export: the page calls `POST /incidents/:id/export`,
 * which applies the detail's rule (owner, admins, the author) and writes
 * `incident.exported` to the audit log. So it is reached by an ordinary link
 * opened in a new tab, never prefetched.
 */
export default async function IncidentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;

  const loaded = await exportIncidentAction(id);
  if (isMissing(loaded)) notFound();
  if (loaded.state !== 'ok') {
    return (
      <main className="p-6">
        <PageError
          message={t(loaded.state === 'refused' ? 'incidents.detailRefused' : loaded.failure.key)}
        />
      </main>
    );
  }
  const { facts, detail, lifeguardQualifications, exportedAt } = loaded.data;

  // A `YYYY-MM-DD` is a day, never a UTC instant — noon keeps it on its day.
  const day = (iso: string | null): string =>
    iso === null ? '—' : formatDate(new Date(`${iso}T12:00:00Z`));
  const words = (value: string | null): string =>
    value === null || value.trim() === '' ? t('incidents.nothingWritten') : value;

  const Row = ({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement => (
    <>
      <dt className="text-black/70">{label}</dt>
      <dd>{children}</dd>
    </>
  );

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 text-[10pt] leading-snug text-black print:max-w-none print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 14mm; }
        @media print { section { break-inside: avoid; } }
      `}</style>

      <AutoPrint />

      <div className="mb-6 print:hidden">
        <PrintButton label={t('export.pdf.printLabel')} />
      </div>

      <header className="border-b border-black/40 pb-3">
        <h1 className="text-[16pt] font-bold">
          {t('incidents.oneTitle', { when: formatStamp(facts.occurredAt) })}
        </h1>
        <p className="mt-0.5">{facts.facilityName}</p>
        <p className="mt-0.5 text-black/70">
          {t('incidents.print.exportedAt', { at: formatStamp(exportedAt) })}
        </p>
      </header>

      <section className="mt-4">
        <h2 className="text-[8.5pt] font-semibold uppercase tracking-wider text-black/70">
          {t('incidents.factsTitle')}
        </h2>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          <Row label={t('incidents.field.occurredAt')}>{formatStamp(facts.occurredAt)}</Row>
          <Row label={t('incidents.field.place')}>{facts.placeName ?? t('incidents.elsewhere')}</Row>
          <Row label={t('incidents.field.person')}>
            {facts.personName} ({t(`incidents.personKind.${facts.personKind}`)})
          </Row>
          <Row label={t('incidents.field.emergencyServices')}>
            {facts.emergencyCalled ? t('incidents.emergencyCalled') : t('incidents.emergencyNotCalled')}
          </Row>
          <Row label={t('incidents.field.lifeguard')}>
            {facts.lifeguardName ?? t('incidents.noLifeguardNamed')}
          </Row>
          <Row label={t('incidents.field.policyReference')}>
            {facts.policyReference ?? t('incidents.noPolicyReference')}
          </Row>
          <Row label={t('incidents.field.recordedBy')}>
            {t('incidents.recordedByAt', {
              name: facts.recordedByName ?? t('incidents.unknownPerson'),
              at: formatStamp(facts.createdAt),
            })}
          </Row>
        </dl>
      </section>

      {/*
        The lifeguard's licence on the day — the question the insurer asks on
        Monday. Every lifeguard-type record, with whether it was valid then, in
        words: on paper there is no colour to carry it.
      */}
      {facts.lifeguardMembershipId !== null && (
        <section className="mt-4">
          <h2 className="text-[8.5pt] font-semibold uppercase tracking-wider text-black/70">
            {t('incidents.print.licenceTitle')}
          </h2>
          {lifeguardQualifications.length === 0 ? (
            <p className="mt-1">{t('incidents.print.noLicence')}</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {lifeguardQualifications.map((q, index) => (
                <li key={index}>
                  <span className="font-medium">{q.typeName}</span>
                  {q.issuingBody !== null && ` · ${q.issuingBody}`}
                  {' · '}
                  {t('incidents.print.validity', { from: day(q.issuedOn), to: day(q.expiresOn) })}
                  {' · '}
                  <span className="font-medium">
                    {q.validThatDay ? t('incidents.print.validThatDay') : t('incidents.print.notValidThatDay')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-4">
        <h2 className="text-[8.5pt] font-semibold uppercase tracking-wider text-black/70">
          {t('incidents.clinicalTitle')}
        </h2>
        <dl className="mt-1 flex flex-col gap-2">
          <div>
            <dt className="text-black/70">{t('incidents.field.whatHappened')}</dt>
            <dd className="whitespace-pre-line">{words(detail.whatHappened)}</dd>
          </div>
          <div>
            <dt className="text-black/70">{t('incidents.field.injury')}</dt>
            <dd className="whitespace-pre-line">{words(detail.injury)}</dd>
          </div>
          <div>
            <dt className="text-black/70">{t('incidents.field.firstAid')}</dt>
            <dd className="whitespace-pre-line">{words(detail.firstAid)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-4">
        <h2 className="text-[8.5pt] font-semibold uppercase tracking-wider text-black/70">
          {t('incidents.addendaTitle')}
        </h2>
        {detail.addenda.length === 0 ? (
          <p className="mt-1">{t('incidents.noAddenda')}</p>
        ) : (
          <ol className="mt-1 flex flex-col gap-2">
            {detail.addenda.map((addendum, index) => (
              <li key={addendum.id}>
                <p className="text-black/70">
                  {t('incidents.addendumLine', {
                    number: index + 1,
                    name: addendum.writtenByName ?? t('incidents.unknownPerson'),
                    at: formatStamp(addendum.createdAt),
                  })}
                </p>
                <p className="whitespace-pre-line">{addendum.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="mt-6 border-t border-black/40 pt-2 text-[8.5pt] text-black/70">
        {t('incidents.print.footer')}
      </p>
    </main>
  );
}
