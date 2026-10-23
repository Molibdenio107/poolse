'use client';

import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { FromLink } from '@/components/from-link';
import { FileCheck, FileText, Trash2 } from 'lucide-react';
import type { MedicalLeave } from '@/lib/api';
import { AttachedDocument, DocumentLink } from '@/components/file-upload';
import {
  CONTROL_LINE,
  FIELD_COLUMN,
  FIELD_LABEL,
  useSeeded,
  useSuccessKey,
} from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { addMedicalLeaveAction, removeMedicalLeaveAction } from './sensitive.actions';
import { formatDate, formatStamp } from '@/lib/date-format';

const INITIAL: FormState = { ok: false };

/**
 * Medical leave — round 5.
 *
 * **What it does, said on the screen.** A control that silently changes how a
 * register behaves is worse than no control, so the panel states the rule in
 * plain text: from today forward the register will offer *falta justificada*,
 * nothing already marked moves, and removing the leave stops the offer. An
 * operator should never have to find that out by watching it happen.
 *
 * **The end date is optional and the form says why.** On the day a child breaks
 * a wrist nobody knows the return date, and a required field would make somebody
 * invent one — which then reads as a fact to everybody who sees it afterwards.
 *
 * **The reason is not a diagnosis.** It sits on this page because this is where
 * an absence is explained, but it is a short line for an instructor, not medical
 * detail; that belongs in the notes above, which are encrypted and audited on
 * every read. The hint says so, for the same reason the attendance note does.
 */
export function MedicalLeavePanel({
  organizationId,
  studentId,
  leave,
  canManage,
  storageReady,
}: {
  organizationId: string;
  studentId: string;
  leave: MedicalLeave[];
  canManage: boolean;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(addMedicalLeaveAction, INITIAL);
  // Stays on screen for the next leave, so its fields clear after a save that worked.
  const added = useSuccessKey(state);
  const [startsOn, setStartsOn] = useSeeded<string>('', added);
  const [endsOn, setEndsOn] = useSeeded<string>('', added);
  const [reason, setReason] = useSeeded<string>('', added);
  const [justification, setJustification] = useSeeded<string>('', added);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('sensitive.leaveExplain')}</p>

      {leave.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('sensitive.noLeave')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded border border-border">
          {leave.map((period) => (
            <li
              key={period.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3"
            >
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">
                  {period.endsOn === null
                    ? t('sensitive.leaveFrom', { from: formatDate(period.startsOn) })
                    : t('sensitive.leaveRange', {
                        from: formatDate(period.startsOn),
                        to: formatDate(period.endsOn),
                      })}
                </span>

                {/*
                  "Currently off" as a word, not only as a colour — the same rule
                  every other badge in this app follows.
                */}
                {period.active && (
                  <span className="rounded bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
                    {t('sensitive.leaveActive')}
                  </span>
                )}

                {period.reason !== null && (
                  <span className="text-sm text-foreground-muted">{period.reason}</span>
                )}

                {/*
                  The paperwork, where it is — round 5 follow-up. Shown beside
                  the leave rather than behind a click, because the question it
                  answers ("on what basis is this student excused") is asked at
                  exactly the moment somebody is reading this row.
                */}
                {period.justificationReference !== null && (
                  <span className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground-muted">
                    <FileText aria-hidden className="size-3" />
                    {period.justificationReference}
                  </span>
                )}
              </span>

              <span className="flex items-center gap-3 text-sm text-foreground-muted">
                {period.recordedByName}
                {canManage && (
                  <RemoveLeave
                    organizationId={organizationId}
                    studentId={studentId}
                    leaveId={period.id}
                  />
                )}
              </span>

              <Certificate
                studentId={studentId}
                period={period}
                canManage={canManage}
                storageReady={storageReady}
              />
            </li>
          ))}
        </ul>
      )}

      {/*
        Where the absences go next — round 5, moved and re-shaped in round 6.

        A leave means classes will be missed, and a missed class marked justified
        mints a reposição credit; this is the screen that owes them. It used to
        sit in the save row of the form below, as a text link, which put it in
        two kinds of wrong place at once. It was always there — including on a
        student with no leave at all, where it points at credits that cannot
        exist yet — and being inside the form it read as part of saving, next to
        the submit button, which is the one thing it must not be mistaken for.

        So it appears only once there is a leave to have caused an absence, and
        it sits with the list that is the reason for it rather than with the form
        that creates the next one. A button, because it is now the panel's second
        action rather than a footnote to the first — a wash of the complementary
        green rather than the primary teal, which is what lets it be found
        without competing with Guardar. Two teal buttons would be two primary
        actions; the soft green reads as "also worth doing", which is what it is.

        A tint at 25% with a 60% border, not a solid fill: the palette green is
        already a light colour, so filling it solid makes a block as loud as the
        primary button and needs its own ink to stay readable in dark mode. At a
        quarter strength ordinary `text-foreground` sits on it at 15.9:1 in light
        and 8.6:1 in dark, and the border is what gives the shape its edge. It is
        the same soft-green pairing `person-avatar` and the vacation calendar
        already use.

        Still a link under the styling, and still not a redirect after saving:
        leaving the medical page the instant somebody saves would lose the panel
        they were working in.

        `canManage` as well as a leave, because Reposições is owner and admin
        only — the API refuses the read. Offering an instructor a button to a
        refusal is worse than not offering it.
      */}
      {canManage && leave.length > 0 && (
        <div>
          <FromLink
            href="/dashboard/classes/reposicoes"
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-complementary/60 bg-complementary/25 font-medium text-foreground transition-colors hover:bg-complementary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('sensitive.leaveToReposicoes')}
          </FromLink>
        </div>
      )}

      {canManage && (
        <form action={action} className="flex flex-col gap-3 rounded border border-border bg-surface-muted p-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="studentId" value={studentId} />

          <div className="flex flex-wrap gap-3">
            <div className={`${FIELD_COLUMN} sm:w-44`}>
              <label htmlFor="leave-from" className={FIELD_LABEL}>
                {t('sensitive.leaveStart')}
              </label>
              <input
                id="leave-from"
                name="startsOn"
                type="date"
                required
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
                className={CONTROL_LINE}
              />
            </div>

            <div className={`${FIELD_COLUMN} sm:w-44`}>
              <label htmlFor="leave-to" className={FIELD_LABEL}>
                {t('sensitive.leaveEnd')}
              </label>
              <input
                id="leave-to"
                name="endsOn"
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
                className={CONTROL_LINE}
              />
              <p className="text-xs text-foreground-muted">{t('sensitive.leaveEndHint')}</p>
            </div>
          </div>

          <div className={`${FIELD_COLUMN} max-w-form`}>
            <label htmlFor="leave-reason" className={FIELD_LABEL}>
              {t('sensitive.leaveReason')}
            </label>
            <input
              id="leave-reason"
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              className={CONTROL_LINE}
            />
            <p className="text-xs text-foreground-muted">{t('sensitive.leaveReasonHint')}</p>
          </div>

          <div className={`${FIELD_COLUMN} max-w-form`}>
            <label htmlFor="leave-justification" className={FIELD_LABEL}>
              {t('sensitive.leaveJustification')}
            </label>
            <input
              id="leave-justification"
              name="justificationReference"
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              maxLength={200}
              placeholder={t('sensitive.leaveJustificationPlaceholder')}
              className={CONTROL_LINE}
            />
            {/*
              Two things said plainly: it is optional, and it is a reference
              rather than the document. Somebody who expects to attach a PDF
              should find that out here, not after typing one in.
            */}
            <p className="text-xs text-foreground-muted">
              {t('sensitive.leaveJustificationHint')}
            </p>
          </div>


          {/*
            The atestado itself is filed on the leave once it exists (POOLSE-109):
            a file belongs to a record, and the record is what this form makes.
          */}
          <p className="text-sm text-foreground-muted">{t('sensitive.certificateAfterSave')}</p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
            >
              {pending ? t('common.working') : t('sensitive.saveLeave')}
            </button>

          </div>
        </form>
      )}
    </div>
  );
}

function RemoveLeave({
  organizationId,
  studentId,
  leaveId,
}: {
  organizationId: string;
  studentId: string;
  leaveId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeMedicalLeaveAction, INITIAL);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="leaveId" value={leaveId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('sensitive.removeLeave')}
        title={t('sensitive.removeLeave')}
        className="rounded p-1 text-foreground-muted transition-colors hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </form>
  );
}

/**
 * The atestado on one leave — POOLSE-109. The office files, replaces, opens and
 * removes it, and sees the earlier ones. A coach is told it is attached and
 * when, and nothing else: not the document, not its name.
 */
function Certificate({
  studentId,
  period,
  canManage,
  storageReady,
}: {
  studentId: string;
  period: MedicalLeave;
  canManage: boolean;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const current = period.certificate;

  if (!canManage) {
    return (
      <span className="flex w-full items-center gap-1.5 text-sm text-foreground-muted">
        <FileCheck aria-hidden className="size-4" />
        {current === null
          ? t('sensitive.certificateNone')
          : t('sensitive.certificateAttachedOn', { date: formatDate(current.attachedAt) })}
      </span>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 pt-1">
      <span className="text-sm font-medium">{t('sensitive.atestado')}</span>
      {current?.file != null && (
        <p className="text-sm">
          <span className="font-medium">{current.file.originalName}</span>
          <span className="text-foreground-muted">
            {' — '}
            {t('sensitive.certificateBy', {
              name: current.file.attachedBy,
              date: formatStamp(current.file.attachedAt),
            })}
          </span>
        </p>
      )}
      <AttachedDocument
        fileId={current?.file?.fileId ?? null}
        target={`medical-certificate:${studentId}:${period.id}`}
        canManage
        storageReady={storageReady}
        contentType={current?.file?.contentType}
        fileName={current?.file?.originalName}
      />
      {period.previousCertificates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-foreground-muted">{t('sensitive.certificatePrevious')}</span>
          <ul className="flex flex-col gap-1.5">
            {period.previousCertificates.map((version) => (
              <li key={`${version.fileId}-${version.replacedAt}`} className="flex flex-col gap-0.5 text-sm">
                <DocumentLink
                  fileId={version.fileId}
                  contentType={version.contentType}
                  fileName={version.originalName}
                  quiet
                />
                <span className="text-foreground-muted">
                  {t('sensitive.certificatePreviousLine', {
                    attachedBy: version.attachedBy,
                    attachedAt: formatStamp(version.attachedAt),
                    replacedBy: version.replacedBy,
                    replacedAt: formatStamp(version.replacedAt),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
