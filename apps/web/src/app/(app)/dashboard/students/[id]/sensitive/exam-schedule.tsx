'use client';

import { useTranslations } from 'next-intl';
import { CalendarClock, Mail, MessageCircle } from 'lucide-react';
import { ConfirmAction, ConfirmButton } from '@/components/confirm-action';
import { TextAreaField, TextField, useSeeded } from '@/components/ui/field';
import { formatDate } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../actions';
import {
  cancelScheduleAction,
  createScheduleAction,
  remindAction,
  type ReminderState,
} from './exam-schedule.actions';

export interface ExamScheduleData {
  schedule: {
    id: string;
    kind: 'appointment' | 'deadline';
    dueOn: string;
    dueTime: string | null;
    place: string | null;
    note: string | null;
    overdue: boolean;
    avisoUntil: string | null;
    reminded: boolean;
  } | null;
  recipients: { name: string; isGuardian: boolean; hasEmail: boolean; hasPhone: boolean }[];
  messagesOn: boolean;
  emailConfigured: boolean;
  locale: string;
}

const INITIAL: FormState = { ok: false };
const REMINDER: ReminderState = { ok: false };

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';
const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted disabled:opacity-60';
const INPUT = 'h-control rounded-sm border border-border-strong bg-background px-2 text-control';

/**
 * *Agendar exame médico* — POOLSE-192. Owner and admin only, like the record it
 * sits beside. Marked for a date, or to be done by one. A change is a cancel and a
 * new one, so a reminder sent never quietly means another date. A warning, never
 * a gate: nothing else reads it.
 */
export function ExamSchedule({
  studentId,
  data,
  today,
  reminderSubject,
  reminderBody,
}: {
  studentId: string;
  data: ExamScheduleData;
  today: string;
  /** Written in the club's language, because the message is the club's. */
  reminderSubject: string;
  reminderBody: string;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <CalendarClock aria-hidden className="size-4" />
        {t('examSchedule.title')}
      </h3>
      {data.schedule === null ? (
        <ScheduleForm studentId={studentId} today={today} />
      ) : (
        <OpenSchedule
          studentId={studentId}
          data={data}
          schedule={data.schedule}
          reminderSubject={reminderSubject}
          reminderBody={reminderBody}
        />
      )}
    </div>
  );
}

function ScheduleForm({ studentId, today }: { studentId: string; today: string }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createScheduleAction, INITIAL);
  const [kind, setKind] = useSeeded<string>('appointment');
  const [dueOn, setDueOn] = useSeeded<string>('');
  const [dueTime, setDueTime] = useSeeded<string>('');
  const error = (name: string): string | null =>
    state.fields?.[name] === undefined ? null : t(state.fields[name] as never);
  const place = error('place');
  const note = error('note');
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap items-start gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('examSchedule.kindLabel')}
          <select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className={INPUT}>
            <option value="appointment">{t('examSchedule.kind.appointment')}</option>
            <option value="deadline">{t('examSchedule.kind.deadline')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('examSchedule.date')}
          <input
            type="date"
            name="dueOn"
            required
            min={today}
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            className={INPUT}
          />
          {error('dueOn') !== null && <span className="text-danger">{error('dueOn')}</span>}
        </label>
        {kind === 'appointment' && (
          <label className="flex flex-col gap-1 text-sm">
            {t('examSchedule.time')}
            <input
              type="time"
              name="dueTime"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              className={INPUT}
            />
            {error('dueTime') !== null && <span className="text-danger">{error('dueTime')}</span>}
          </label>
        )}
      </div>
      <TextField
        name="place"
        label={t('examSchedule.place')}
        maxLength={200}
        {...(place === null ? {} : { error: place })}
      />
      <TextAreaField
        name="note"
        label={t('examSchedule.note')}
        hint={t('examSchedule.noteHint')}
        rows={2}
        maxLength={500}
        {...(note === null ? {} : { error: note })}
      />
      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {t('examSchedule.save')}
        </button>
      </div>
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey as never)}
        </p>
      )}
    </form>
  );
}

function OpenSchedule({
  studentId,
  data,
  schedule,
  reminderSubject,
  reminderBody,
}: {
  studentId: string;
  data: ExamScheduleData;
  schedule: NonNullable<ExamScheduleData['schedule']>;
  reminderSubject: string;
  reminderBody: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, cancel, cancelling] = useSavedAction(cancelScheduleAction, INITIAL);
  const date = formatDate(schedule.dueOn);
  const headline =
    schedule.kind === 'deadline'
      ? t('examSchedule.state.deadline', { date })
      : schedule.dueTime === null
        ? t('examSchedule.state.appointment', { date })
        : t('examSchedule.state.appointmentAt', { date, time: schedule.dueTime });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded border border-primary bg-primary/[0.08] p-4">
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium">{headline}</p>
          {schedule.place !== null && <p>{t('examSchedule.placeLine', { place: schedule.place })}</p>}
          {schedule.note !== null && <p className="whitespace-pre-wrap text-foreground-muted">{schedule.note}</p>}
          {schedule.overdue && <p className="font-medium text-warning">{t('examSchedule.overdue')}</p>}
          <p className="text-foreground-muted">
            {schedule.avisoUntil !== null
              ? t('examSchedule.avisoUntil', { date: formatDate(schedule.avisoUntil) })
              : schedule.reminded
                ? t('examSchedule.reminded')
                : t('examSchedule.notReminded')}
          </p>
        </div>
        <ConfirmAction
          action={cancel}
          pending={cancelling}
          fields={{ studentId, scheduleId: schedule.id }}
          tone="danger"
          title={t('examSchedule.cancelTitle')}
          message={t('examSchedule.cancelMessage')}
          confirmLabel={t('examSchedule.cancel')}
          trigger={t('examSchedule.cancel')}
          triggerClassName="inline-flex h-control items-center rounded-sm px-4 text-control text-danger hover:underline disabled:opacity-60"
        />
      </div>
      {data.messagesOn ? (
        <Reminder
          studentId={studentId}
          scheduleId={schedule.id}
          data={data}
          firstTime={!schedule.reminded}
          subject={reminderSubject}
          body={reminderBody}
        />
      ) : (
        <p className="text-sm text-foreground-muted">{t('examSchedule.messagesOff')}</p>
      )}
    </div>
  );
}

function Reminder({
  studentId,
  scheduleId,
  data,
  firstTime,
  subject,
  body,
}: {
  studentId: string;
  scheduleId: string;
  data: ExamScheduleData;
  firstTime: boolean;
  subject: string;
  body: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(remindAction, REMINDER);
  const anyEmail = data.recipients.some((one) => one.hasEmail);
  const anyPhone = data.recipients.some((one) => one.hasPhone);
  const who = data.recipients
    .map((one) => (one.isGuardian ? t('studentMessages.guardian', { name: one.name }) : one.name))
    .join(', ');
  const error = (name: string): string | null =>
    state.fields?.[name] === undefined ? null : t(state.fields[name] as never);
  const subjectError = error('subject');
  const bodyError = error('body');
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <h4 className="text-sm font-medium">{t('examSchedule.reminderTitle')}</h4>
      <p className="text-sm">{t('studentMessages.to', { who })}</p>
      {firstTime && <p className="text-sm text-foreground-muted">{t('examSchedule.firstReminder')}</p>}
      {!data.emailConfigured && <p className="text-sm text-foreground-muted">{t('studentMessages.emailOff')}</p>}
      {!anyEmail && <p className="text-sm text-foreground-muted">{t('studentMessages.noEmail')}</p>}
      {!anyPhone && <p className="text-sm text-foreground-muted">{t('studentMessages.noPhone')}</p>}
      <TextField
        name="subject"
        label={t('studentMessages.subject')}
        required
        maxLength={200}
        initial={subject}
        {...(subjectError === null ? {} : { error: subjectError })}
      />
      <TextAreaField
        name="body"
        label={t('studentMessages.body')}
        required
        rows={4}
        initial={body}
        {...(bodyError === null ? {} : { error: bodyError })}
      />
      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          name="channel"
          value="email"
          disabled={pending || !anyEmail}
          title={t('studentMessages.confirmTitle')}
          message={t('studentMessages.confirmEmail', { who })}
          confirmLabel={t('studentMessages.sendEmail')}
          className={PRIMARY}
        >
          <Mail aria-hidden className="size-4" />
          {t('studentMessages.sendEmail')}
        </ConfirmButton>
        <ConfirmButton
          name="channel"
          value="whatsapp"
          disabled={pending || !anyPhone}
          title={t('studentMessages.confirmTitle')}
          message={t('studentMessages.confirmWhatsapp')}
          confirmLabel={t('studentMessages.prepareWhatsapp')}
          className={SECONDARY}
        >
          <MessageCircle aria-hidden className="size-4" />
          {t('studentMessages.prepareWhatsapp')}
        </ConfirmButton>
      </div>
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey as never, state.values as never)}
        </p>
      )}
      {(state.links ?? []).length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-primary bg-primary/[0.08] p-4">
          <p className="text-sm font-medium">{t('studentMessages.openNow')}</p>
          <ul className="flex flex-wrap gap-2">
            {state.links!.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer" className={SECONDARY}>
                  <MessageCircle aria-hidden className="size-4" />
                  {t('studentMessages.open', { name: link.name })}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
