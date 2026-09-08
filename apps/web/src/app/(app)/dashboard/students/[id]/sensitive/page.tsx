import { getFormatter, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import {
  ApiError,
  apiFetch,
  type SensitiveRecord,
  type Student,
} from '../../../../../../lib/api';
import { BackLink } from '@/components/back-link';
import { ChevronRight } from 'lucide-react';
import { MedicalLeavePanel } from './medical-leave';
import { PageError, PageShell } from '@/components/page-shell';
import {
  EmergencyContactForm,
  MedicalNotesForm,
  RecordConsentForm,
  WithdrawConsentButton,
} from './sensitive-forms';

/**
 * Medical notes and consent, on their own screen behind a deliberate click.
 *
 * That separation is the point of the slice, twice over. It keeps
 * special-category data off the register that every member of the organization
 * can read — and it makes the audit entry mean something. If these loaded with
 * the student record, opening the page to correct a phone number would write
 * "read medical notes" to the log, and a log full of accidents is a log nobody
 * can answer a parent's question with.
 */
export default async function SensitivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { id } = await params;

  let student: Student | null = null;
  let record: SensitiveRecord | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;
  let missing = false;

  try {
    // Fetched in sequence rather than together: if the caller is not allowed to
    // see this, there is no reason to have looked the student up at all.
    record = await apiFetch<SensitiveRecord>(`/students/${id}/sensitive`);
    student = await apiFetch<Student>(`/students/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else if (error instanceof ApiError && error.status === 404) missing = true;
    else failure = describeLoad(error);
  }

  const live = record?.consent.filter((entry) => entry.withdrawnAt === null) ?? [];
  const past = record?.consent.filter((entry) => entry.withdrawnAt !== null) ?? [];

  return (
    <PageShell
      // The full legal name — a detail page, not a list (POOLSE-32 criterion 3).
      title={student === null ? t('sensitive.title') : student.displayName}
      subtitle={t('sensitive.title')}
    >

      <BackLink href={`/dashboard/students/${id}`} label={t('sensitive.backToStudent')} />

      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('sensitive.notPermitted')}</p>
        </section>
      )}

      {missing && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('students.notFound')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {record !== null && (
        <>
          {/*
            Said out loud, on the screen where it happens. Somebody whose access
            is logged should know it is logged — that is what makes the trail
            fair as well as useful.
          */}
          <p className="rounded border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            {t('sensitive.accessLogged')}
          </p>

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('sensitive.medicalNotes')}
            </h2>
            {record.notes.recordedAt !== null && (
              <p className="mb-4 text-sm text-foreground-muted">
                {t('sensitive.lastRecorded', {
                  who: record.notes.recordedByName ?? t('account.noName'),
                  when: format.dateTime(new Date(record.notes.recordedAt), {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  }),
                })}
              </p>
            )}

            {record.canManage ? (
              <MedicalNotesForm
                organizationId={record.organizationId}
                studentId={id}
                notes={record.notes.medicalNotes}
                mobilityNotes={record.notes.mobilityNotes}
              />
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-medium">{t('sensitive.medicalLabel')}</h3>
                  <p className="mt-1 whitespace-pre-wrap">
                    {record.notes.medicalNotes ?? t('sensitive.noNotes')}
                  </p>
                </div>
                {/*
                  Read by the same people as the medical notes, and shown to them
                  the same way — an instructor who may read one and not the other
                  would be a distinction nobody could explain at a poolside.
                */}
                <div>
                  <h3 className="text-sm font-medium">{t('sensitive.mobilityLabel')}</h3>
                  <p className="mt-1 whitespace-pre-wrap">
                    {record.notes.mobilityNotes ?? t('sensitive.noMobilityNotes')}
                  </p>
                </div>
                <p className="text-sm text-foreground-muted">{t('sensitive.readOnly')}</p>
              </div>
            )}
          </section>

          {/*
            Who to call — POOLSE-23 AC3.

            Its own section rather than a field inside the notes, because it is
            not a note: it is a person, and on the adult path it is the only
            contact the record has. Read by whoever may read the notes above —
            an emergency contact only the office can see is one nobody can use.
          */}
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('sensitive.emergencyTitle')}
            </h2>
            <p className="mb-4 text-sm text-foreground-muted">
              {record.enrolment?.adultPath === true
                ? t('sensitive.emergencyHintAdult')
                : t('sensitive.emergencyHint')}
            </p>

            {record.canManage ? (
              <EmergencyContactForm
                organizationId={record.organizationId}
                studentId={id}
                contact={record.emergencyContact}
                people={record.contactCandidates}
              />
            ) : record.emergencyContact?.name === null ? (
              <p className="text-foreground-muted">{t('sensitive.emergencyNone')}</p>
            ) : (
              <p>
                {record.emergencyContact?.name}
                {record.emergencyContact?.relationship === null
                  ? ''
                  : ` · ${record.emergencyContact?.relationship}`}
                {record.emergencyContact?.phone === null
                  ? ''
                  : ` · ${record.emergencyContact?.phone}`}
              </p>
            )}
          </section>

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('sensitive.consent')}
            </h2>

            {live.length === 0 ? (
              <p className="text-foreground-muted">{t('sensitive.noConsent')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {live.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-3 first:pt-0"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span>
                        {t(`sensitive.kinds.${entry.kind}`)} —{' '}
                        <span className={entry.granted ? 'text-success' : 'text-danger'}>
                          {entry.granted ? t('sensitive.granted') : t('sensitive.refused')}
                        </span>
                      </span>
                      <span className="text-sm text-foreground-muted">
                        {t('sensitive.recordedBy', {
                          who: entry.grantedByName ?? t('account.noName'),
                          when: format.dateTime(new Date(entry.grantedAt), { dateStyle: 'long' }),
                        })}
                      </span>
                      {entry.evidenceNote !== null && (
                        <span className="text-sm text-foreground-muted">
                          {t('sensitive.evidence')}: {entry.evidenceNote}
                        </span>
                      )}
                    </div>
                    {record.canManage && (
                      <WithdrawConsentButton
                        organizationId={record.organizationId}
                        studentId={id}
                        consentId={entry.id}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {record.canManage && (
              <div className="mt-5 border-t border-border pt-5">
                <h3 className="mb-3 text-sm text-foreground-muted">{t('sensitive.record')}</h3>
                <RecordConsentForm
                  organizationId={record.organizationId}
                  studentId={id}
                  kinds={record.kinds}
                />
              </div>
            )}
          </section>

          {/*
            Its own card, below consent — round 5. A leave is not a consent and
            not a medical note: it is an operational fact about the next six
            weeks of registers, and it belongs where somebody looking for "why is
            this child not in the water" would look.
          */}
          {/*
            Folded — round 5. Most students have no leave and never will, so an
            open panel of date fields on every medical page is a permanent
            question with no answer. It opens on demand and stays open while it
            is being used.
          */}
          <details className="group rounded border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-2 p-5 text-sm font-medium uppercase tracking-wider text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <ChevronRight
                aria-hidden
                className="size-4 transition-transform group-open:rotate-90"
              />
              {t('sensitive.leave')}
              {record.medicalLeave.some((period) => period.active) && (
                <span className="rounded bg-warning/20 px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-warning">
                  {t('sensitive.leaveActive')}
                </span>
              )}
            </summary>
            <div className="border-t border-border p-5">
            <MedicalLeavePanel
              organizationId={record.organizationId}
              studentId={id}
              leave={record.medicalLeave}
              canManage={record.canManage}
            />
            </div>
          </details>

          {past.length > 0 && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('sensitive.history')}
              </h2>
              <p className="mb-4 text-sm text-foreground-muted">{t('sensitive.historyHint')}</p>
              <ul className="flex flex-col gap-2 text-sm text-foreground-muted">
                {past.map((entry) => (
                  <li key={entry.id}>
                    {t(`sensitive.kinds.${entry.kind}`)} —{' '}
                    {entry.granted ? t('sensitive.granted') : t('sensitive.refused')} ·{' '}
                    {format.dateTime(new Date(entry.grantedAt), { dateStyle: 'medium' })} →{' '}
                    {t('sensitive.withdrawnOn', {
                      when: format.dateTime(new Date(entry.withdrawnAt as string), {
                        dateStyle: 'medium',
                      }),
                      who: entry.withdrawnByName ?? t('account.noName'),
                    })}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}
