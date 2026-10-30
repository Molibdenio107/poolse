'use client';

import { startTransition, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { CircleSlash, Paperclip, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { DocumentLink } from '@/components/file-upload';
import { SelectField, TextAreaField, TextField, useSuccessKey } from '@/components/ui/field';
import { formatDate } from '@/lib/date-format';
import { acceptFor } from '@/lib/files';
import { EXAM_RESULTS, type MedicalExam, type StudentMedicalExams } from '@/lib/medical-exams';
import { useSavedAction } from '@/lib/saved';
import { cn } from '@/lib/utils';
import type { FormState } from '../../../actions';
import { archiveExamAction, attachExamCertificateAction, recordExamAction } from './exam.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border bg-surface text-foreground hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The exame médico — POOLSE-133.
 *
 * **The state is a sentence with an icon**, never a colour alone: *Válido até*,
 * *Expirou a*, *Sem exame registado* — and *Não apto desde* for an exam that
 * found the swimmer unfit, which the API counts as not valid. A validity nobody
 * typed is a year from the exam, and the line says it was estimated.
 *
 * **A warning, never a gate**: nothing here stops a register or an enrolment.
 *
 * **An exam is never edited.** A wrong one is archived and the right one
 * recorded, which the form says. Owner and admin record, attach and archive;
 * an instructor reads the state and the dates, and nothing else.
 */
export function ExamPanel({
  studentId,
  exams,
  canManage,
  storageReady,
}: {
  studentId: string;
  exams: StudentMedicalExams;
  canManage: boolean;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const current = exams.current;

  return (
    <div className="flex flex-col gap-5">
      <ExamState exams={exams} />

      {current !== null && canManage && (
        <div className="flex flex-col gap-3 rounded border border-border p-4">
          <ExamLine exam={current} />
          {current.note !== null && (
            <p className="whitespace-pre-wrap text-sm text-foreground-muted">{current.note}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {current.fileId !== null ? (
              <DocumentLink fileId={current.fileId} />
            ) : (
              <CertificateUpload studentId={studentId} examId={current.id} storageReady={storageReady} />
            )}
            <ArchiveExam studentId={studentId} examId={current.id} />
          </div>
        </div>
      )}

      {canManage && exams.history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('exams.history')}</h3>
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {exams.history.map((exam) => (
              <li key={exam.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <ExamLine exam={exam} />
                  {exam.note !== null && (
                    <span className="whitespace-pre-wrap text-sm text-foreground-muted">{exam.note}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {exam.fileId !== null && <DocumentLink fileId={exam.fileId} quiet fileName={t('exams.certificate')} />}
                  <ArchiveExam studentId={studentId} examId={exam.id} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage ? (
        <RecordExamForm studentId={studentId} />
      ) : (
        <p className="text-sm text-foreground-muted">{t('exams.readOnly')}</p>
      )}
    </div>
  );
}

/** The one-sentence answer, with its icon. Shared by every reader of the page. */
function ExamState({ exams }: { exams: StudentMedicalExams }): React.ReactElement {
  const t = useTranslations();
  const current = exams.current;

  if (exams.state === 'none' || current === null) {
    return (
      <p className="flex items-center gap-2 font-medium">
        <CircleSlash aria-hidden className="size-5 shrink-0 text-foreground-muted" />
        {t('exams.state.none')}
      </p>
    );
  }

  const until = current.validUntil === null ? null : formatDate(current.validUntil);

  if (exams.state === 'valid') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <ShieldCheck aria-hidden className="size-5 shrink-0 text-success" />
        {t('exams.state.valid', { date: until ?? '' })}
        {current.validUntilAssumed && (
          <span className="text-sm font-normal text-foreground-muted">({t('exams.assumed')})</span>
        )}
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-warning">
      <ShieldAlert aria-hidden className="size-5 shrink-0" />
      {current.result === 'unfit'
        ? t('exams.state.unfit', { date: formatDate(current.examinedOn) })
        : until === null
          ? t('exams.state.expiredUnknown')
          : t('exams.state.expired', { date: until })}
      {current.result !== 'unfit' && current.validUntilAssumed && (
        <span className="text-sm font-normal text-foreground-muted">({t('exams.assumed')})</span>
      )}
    </p>
  );
}

function ExamLine({ exam }: { exam: MedicalExam }): React.ReactElement {
  const t = useTranslations();
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-medium">
        {t('exams.line', { date: formatDate(exam.examinedOn), result: t(`exams.result.${exam.result}`) })}
      </span>
      {exam.validUntil !== null && (
        <span className="text-foreground-muted">
          {exam.validUntilAssumed
            ? t('exams.lineUntilAssumed', { date: formatDate(exam.validUntil) })
            : t('exams.lineUntil', { date: formatDate(exam.validUntil) })}
        </span>
      )}
    </span>
  );
}

function RecordExamForm({ studentId }: { studentId: string }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(recordExamAction, INITIAL);
  // Stays on screen for the next exam: remounted after a save that worked, and
  // never after one that failed, so a refusal keeps what was typed.
  const added = useSuccessKey(state);
  const error = (field: string): string | undefined =>
    state.fields?.[field] === undefined ? undefined : t(state.fields[field] as never);

  return (
    <form
      key={added}
      action={action}
      className="flex flex-col gap-3 rounded border border-border bg-surface-muted p-4"
    >
      <h3 className="text-sm font-medium">{t('exams.record')}</h3>
      <input type="hidden" name="studentId" value={studentId} />

      <div className="flex flex-wrap gap-3">
        <TextField
          name="examinedOn"
          type="date"
          label={t('exams.field.examinedOn')}
          required
          error={error('examinedOn')}
          className="sm:w-44"
        />
        <SelectField
          name="result"
          label={t('exams.field.result')}
          required
          error={error('result')}
          options={[
            { value: '', label: t('exams.chooseResult') },
            ...EXAM_RESULTS.map((result) => ({ value: result, label: t(`exams.result.${result}`) })),
          ]}
          className="sm:w-60"
        />
        <TextField
          name="validUntil"
          type="date"
          label={t('exams.field.validUntil')}
          error={error('validUntil')}
          className="sm:w-44"
        />
      </div>
      <p className="text-sm text-foreground-muted">{t('exams.validUntilHint')}</p>

      <TextAreaField
        name="note"
        label={t('exams.note')}
        hint={t('exams.noteHint')}
        maxLength={500}
        rows={2}
        error={error('note')}
      />

      <p className="text-sm text-foreground-muted">{t('exams.correctionHint')}</p>

      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? t('common.working') : t('exams.save')}
        </button>
      </div>
    </form>
  );
}

function ArchiveExam({ studentId, examId }: { studentId: string; examId: string }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(archiveExamAction, INITIAL);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="examId" value={examId} />
      <button type="submit" disabled={pending} className={BUTTON_QUIET}>
        <Trash2 aria-hidden className="size-4" />
        {t('exams.archive')}
      </button>
    </form>
  );
}

/**
 * The certificate, sent to the exam's own route in one step (sealed health
 * data, as the atestado is). A hidden picker behind a button, as `FileUpload`.
 */
function CertificateUpload({
  studentId,
  examId,
  storageReady,
}: {
  studentId: string;
  examId: string;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [, dispatch, pending] = useSavedAction(attachExamCertificateAction, INITIAL);

  function chosen(files: FileList | null): void {
    const file = files?.[0];
    if (file !== undefined) {
      const data = new FormData();
      data.set('studentId', studentId);
      data.set('examId', examId);
      data.set('file', file);
      startTransition(() => dispatch(data));
    }
    if (input.current !== null) input.current.value = '';
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={!storageReady || pending}
        onClick={() => input.current?.click()}
        className={cn(BUTTON_QUIET, (!storageReady || pending) && 'cursor-not-allowed')}
      >
        <Paperclip aria-hidden className="size-4" />
        {pending ? t('files.uploading') : t('exams.attachCertificate')}
      </button>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={acceptFor('medical_certificate')}
        onChange={(event) => chosen(event.target.files)}
      />
      <span className="text-sm text-foreground-muted">
        {storageReady ? t('files.certificateHint') : t('files.notConfigured')}
      </span>
    </div>
  );
}
