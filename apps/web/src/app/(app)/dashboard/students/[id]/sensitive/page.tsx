import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { backTarget } from '@/lib/back';
import {
  ApiError,
  apiFetch,
  type SensitiveRecord,
  type Student,
} from '../../../../../../lib/api';
import { DetailPage } from '@/components/detail-page';
import { MedicalLeavePanel } from './medical-leave';
import { ExamPanel } from './exam-panel';
import type { StudentMedicalExams } from '@/lib/medical-exams';
import { storageConfigured } from '@/lib/storage-status';
import { PageError, PageShell } from '@/components/page-shell';
import { formatDate, formatStamp } from '@/lib/date-format';
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
 *
 * **Tabs since the detail-tabs change**: General (the notes), Contacto de
 * emergência, Consentimentos, Baixa médica and Histórico — all rendered from the
 * one audited read, so switching tabs logs nothing more.
 */
export default async function SensitivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const { tab, from } = await searchParams;

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

  const target = backTarget(from, `/dashboard/students/${id}`);
  const back = { href: target.href, label: t(target.labelKey) };

  if (record === null) {
    return (
      <PageShell title={t('sensitive.title')} back={back}>
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
      </PageShell>
    );
  }

  const loaded = record;
  const storageReady = await storageConfigured();

  // The exame médico — POOLSE-133. Its own read: a failure costs this tab a
  // sentence, never the page, and is said rather than shown as "no exam".
  let exams: StudentMedicalExams | null = null;
  try {
    exams = await apiFetch<StudentMedicalExams>(`/students/${id}/medical-exams`);
  } catch {
    exams = null;
  }

  return (
    <DetailPage
      // The full legal name — a detail page, not a list (POOLSE-32 criterion 3).
      title={student === null ? t('sensitive.title') : student.displayName}
      subtitle={t('sensitive.title')}
      back={back}
      requested={tab}
      /*
        Eager: every read of this record writes an audit entry, so the tabs all
        arrive with the one read the page makes and switching between them asks
        the server for nothing. Per-tab fetching would log a read per click.
      */
      eager
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <>
              {/*
                Said out loud, on the screen where it happens. Somebody whose
                access is logged should know it is logged — that is what makes
                the trail fair as well as useful.
              */}
              <p className="rounded border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
                {t('sensitive.accessLogged')}
              </p>

              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('sensitive.medicalNotes')}
                </h2>
                {loaded.notes.recordedAt !== null && (
                  <p className="mb-4 text-sm text-foreground-muted">
                    {t('sensitive.lastRecorded', {
                      who: loaded.notes.recordedByName ?? t('account.noName'),
                      when: formatStamp(new Date(loaded.notes.recordedAt)),
                    })}
                  </p>
                )}

                {loaded.canManage ? (
                  <MedicalNotesForm
                    organizationId={loaded.organizationId}
                    studentId={id}
                    notes={loaded.notes.medicalNotes}
                    mobilityNotes={loaded.notes.mobilityNotes}
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h3 className="text-sm font-medium">{t('sensitive.medicalLabel')}</h3>
                      <p className="mt-1 whitespace-pre-wrap">
                        {loaded.notes.medicalNotes ?? t('sensitive.noNotes')}
                      </p>
                    </div>
                    {/*
                      Read by the same people as the medical notes, and shown to
                      them the same way — an instructor who may read one and not
                      the other would be a distinction nobody could explain at a
                      poolside.
                    */}
                    <div>
                      <h3 className="text-sm font-medium">{t('sensitive.mobilityLabel')}</h3>
                      <p className="mt-1 whitespace-pre-wrap">
                        {loaded.notes.mobilityNotes ?? t('sensitive.noMobilityNotes')}
                      </p>
                    </div>
                    <p className="text-sm text-foreground-muted">{t('sensitive.readOnly')}</p>
                  </div>
                )}
              </section>
            </>
          ),
        },
        {
          /*
            Who to call — POOLSE-23 AC3. Its own tab rather than a field inside
            the notes, because it is not a note: it is a person, and on the adult
            path it is the only contact the record has.
          */
          slug: 'emergency',
          labelKey: 'sensitive.emergencyTitle',
          content: () => (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('sensitive.emergencyTitle')}
              </h2>
              <p className="mb-4 text-sm text-foreground-muted">
                {loaded.enrolment?.adultPath === true
                  ? t('sensitive.emergencyHintAdult')
                  : t('sensitive.emergencyHint')}
              </p>

              {loaded.canManage ? (
                <EmergencyContactForm
                  organizationId={loaded.organizationId}
                  studentId={id}
                  contact={loaded.emergencyContact}
                />
              ) : loaded.emergencyContact?.name === null ? (
                <p className="text-foreground-muted">{t('sensitive.emergencyNone')}</p>
              ) : (
                <p>
                  {loaded.emergencyContact?.name}
                  {loaded.emergencyContact?.relationship === null
                    ? ''
                    : ` · ${loaded.emergencyContact?.relationship}`}
                  {loaded.emergencyContact?.phone === null
                    ? ''
                    : ` · ${loaded.emergencyContact?.phone}`}
                </p>
              )}
            </section>
          ),
        },
        {
          slug: 'consent',
          labelKey: 'sensitive.consent',
          content: () => (
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
                            when: formatDate(new Date(entry.grantedAt)),
                          })}
                        </span>
                        {entry.evidenceNote !== null && (
                          <span className="text-sm text-foreground-muted">
                            {t('sensitive.evidence')}: {entry.evidenceNote}
                          </span>
                        )}
                      </div>
                      {loaded.canManage && (
                        <WithdrawConsentButton
                          organizationId={loaded.organizationId}
                          studentId={id}
                          consentId={entry.id}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {loaded.canManage && (
                <div className="mt-5 border-t border-border pt-5">
                  <h3 className="mb-3 text-sm text-foreground-muted">{t('sensitive.record')}</h3>
                  <RecordConsentForm
                    organizationId={loaded.organizationId}
                    studentId={id}
                    kinds={loaded.kinds}
                  />
                </div>
              )}
            </section>
          ),
        },
        {
          /*
            Its own tab — round 5. A leave is not a consent and not a medical
            note: it is an operational fact about the next six weeks of
            registers. Open, not folded (Rui, 28-10-2026): the tab is already
            the choice to look, so a second click inside it only hid the list.
          */
          slug: 'leave',
          labelKey: 'sensitive.leave',
          badge: loaded.medicalLeave.some((period) => period.active)
            ? { kind: 'dot', labelKey: 'sensitive.leaveActive' }
            : undefined,
          content: () => (
            <section className="rounded border border-border bg-surface">
              <h2 className="flex items-center gap-2 p-5 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('sensitive.leave')}
                {loaded.medicalLeave.some((period) => period.active) && (
                  <span className="rounded bg-warning/20 px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-warning">
                    {t('sensitive.leaveActive')}
                  </span>
                )}
              </h2>
              <div className="border-t border-border p-5">
                <MedicalLeavePanel
                  organizationId={loaded.organizationId}
                  studentId={id}
                  leave={loaded.medicalLeave}
                  canManage={loaded.canManage}
                  storageReady={storageReady}
                />
              </div>
            </section>
          ),
        },
        {
          /*
            The exame médico — POOLSE-133. Its own tab, beside the leave: a
            date that runs out, read by everyone who opens this page, the file
            and the note by the office only. A dot when it has run out.
          */
          slug: 'exam',
          labelKey: 'exams.title',
          badge:
            exams?.state === 'expired'
              ? { kind: 'dot', labelKey: 'exams.needsAttention' }
              : undefined,
          content: () => (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('exams.title')}
              </h2>
              {exams === null ? (
                <PageError message={t('exams.loadFailed')} />
              ) : (
                <ExamPanel
                  studentId={id}
                  exams={exams}
                  canManage={loaded.canManage}
                  storageReady={storageReady}
                />
              )}
            </section>
          ),
        },
        {
          slug: 'history',
          labelKey: 'sensitive.history',
          visible: past.length > 0,
          content: () => (
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
                    {formatDate(new Date(entry.grantedAt))} →{' '}
                    {t('sensitive.withdrawnOn', {
                      when: formatDate(new Date(entry.withdrawnAt as string)),
                      who: entry.withdrawnByName ?? t('account.noName'),
                    })}
                  </li>
                ))}
              </ul>
            </section>
          ),
        },
      ]}
    />
  );
}
