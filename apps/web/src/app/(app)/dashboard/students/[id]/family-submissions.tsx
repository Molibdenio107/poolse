'use client';

import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { DocumentLink } from '@/components/file-upload';
import { useSeeded } from '@/components/ui/field';
import { formatDate, formatStamp } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { decideSubmissionAction } from './submissions.actions';

export interface FamilySubmission {
  id: string;
  kind: 'fpn_declaration' | 'fpn_declaration_minor' | 'socio_form' | 'id_document' | 'medical_exam';
  fileId: string;
  contentType: string;
  originalName: string;
  examinedOn: string | null;
  submittedAt: string;
  submittedByName: string | null;
  submittedByRole: 'student' | 'guardian';
  studentBirthDate: string | null;
}

const INITIAL: FormState = { ok: false };

/**
 * *Por rever* — POOLSE-179 slice 2. What a family or a student sent and the office
 * has not decided, above the sections, so it is seen whichever one is open. Each
 * line says who sent it, from the sender's relation and never the age (POOLSE-190).
 * Nothing on file changes until *Aceitar*; an exam is accepted with the result
 * the office reads off the certificate. *Rejeitar* files nothing, and destroys
 * a sealed file (an ID photo, an exam). Both ask first.
 */
export function FamilySubmissions({
  studentId,
  submissions,
}: {
  studentId: string;
  submissions: FamilySubmission[];
}): React.ReactElement | null {
  const t = useTranslations();
  if (submissions.length === 0) return null;
  return (
    // Pending until the office decides (POOLSE-214): the emphasised card and the dot.
    <section aria-labelledby="family-submissions" className="attention-card flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <h2 id="family-submissions" className="flex items-center gap-2 font-semibold">
        <Inbox aria-hidden className="size-4" />
        {t('documents.submissions.title', { count: submissions.length })}
        <span aria-hidden className="attention-dot" />
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {submissions.map((one) => (
          <li key={one.id} className="flex flex-col gap-2 py-3">
            <span className="font-medium">{t(`documents.submissions.kind.${one.kind}`)}</span>
            <span className="text-sm text-foreground-muted">
              {t(one.submittedByRole === 'student' ? 'documents.submissions.sentByStudent' : 'documents.submissions.sentByGuardian', {
                name: one.submittedByName ?? t('documents.submissions.someone'),
                when: formatStamp(one.submittedAt),
              })}
              {one.examinedOn !== null && ` · ${t('documents.submissions.examinedOn', { date: formatDate(one.examinedOn) })}`}
            </span>
            <DocumentLink fileId={one.fileId} contentType={one.contentType} fileName={one.originalName} quiet />
            <Decide studentId={studentId} submission={one} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decide({ studentId, submission }: { studentId: string; submission: FamilySubmission }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(decideSubmissionAction, INITIAL);
  const exam = submission.kind === 'medical_exam';
  const [result, setResult] = useSeeded<string>('');
  const [validUntil, setValidUntil] = useSeeded<string>('');
  const id = submission.kind === 'id_document';
  const [birthDate, setBirthDate] = useSeeded<string>(submission.studentBirthDate ?? '');
  const kind = t(`documents.submissions.kind.${submission.kind}`);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="submissionId" value={submission.id} />
      {exam && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t('documents.submissions.result')}
            <select
              name="result"
              required
              value={result}
              onChange={(event) => setResult(event.target.value)}
              className="h-control rounded-sm border border-border-strong bg-background px-2 text-control"
            >
              <option value="" disabled>
                {t('documents.submissions.chooseResult')}
              </option>
              <option value="fit">{t('documents.submissions.results.fit')}</option>
              <option value="fit_with_conditions">{t('documents.submissions.results.fit_with_conditions')}</option>
              <option value="unfit">{t('documents.submissions.results.unfit')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('documents.submissions.validUntil')}
            <input
              type="date"
              name="validUntil"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              className="h-control rounded-sm border border-border-strong bg-background px-2 text-control"
            />
          </label>
        </>
      )}
      {id && (
        <label className="flex flex-col gap-1 text-sm">
          {t('documents.submissions.birthDate')}
          <input
            type="date"
            name="birthDate"
            required
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            className="h-control rounded-sm border border-border-strong bg-background px-2 text-control"
          />
        </label>
      )}
      <ConfirmButton
        name="decision"
        value="accept"
        disabled={pending}
        title={t('documents.submissions.acceptTitle', { kind })}
        message={t(id ? 'documents.submissions.acceptIdMessage' : 'documents.submissions.acceptMessage')}
        confirmLabel={t('documents.submissions.accept')}
        className="inline-flex h-control items-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
      >
        {t('documents.submissions.accept')}
      </ConfirmButton>
      {/* Reject needs no result; `noValidate` lets it through an empty select. */}
      <ConfirmButton
        name="decision"
        value="reject"
        noValidate
        disabled={pending}
        tone="danger"
        title={t('documents.submissions.rejectTitle', { kind })}
        message={t('documents.submissions.rejectMessage')}
        confirmLabel={t('documents.submissions.reject')}
        className="inline-flex h-control items-center rounded-sm px-4 text-control text-danger hover:underline disabled:opacity-60"
      >
        {t('documents.submissions.reject')}
      </ConfirmButton>
      {state.errorKey !== undefined && (
        <p role="alert" className="basis-full text-sm text-danger">
          {t(state.errorKey as never)}
        </p>
      )}
    </form>
  );
}
