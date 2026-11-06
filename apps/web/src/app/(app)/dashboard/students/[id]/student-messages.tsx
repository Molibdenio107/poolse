'use client';

import { useTranslations } from 'next-intl';
import { Mail, MessageCircle, Smartphone } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { TextAreaField, TextField, useSeeded, useSuccessKey } from '@/components/ui/field';
import { formatDate, formatStamp } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import { sendStudentMessageAction, type StudentMessageState } from './student-messages.actions';

export interface StudentMessagesData {
  recipients: { name: string; isGuardian: boolean; hasEmail: boolean; hasPhone: boolean }[];
  messages: {
    id: string;
    channel: 'email' | 'app' | 'whatsapp';
    subject: string;
    body: string;
    sentAt: string;
    sentByName: string | null;
    recipients: string[];
    addressCount: number;
    deliveredCount: number;
    shownUntil: string | null;
  }[];
  emailConfigured: boolean;
}

const INITIAL: StudentMessageState = { ok: false };

const CARD = 'flex flex-col gap-4 rounded bg-surface p-5 shadow-card';
const HEADING = 'text-sm font-medium uppercase tracking-wider text-foreground-muted';
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';
const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted disabled:opacity-60';

/**
 * *Mensagens* on a student — POOLSE-191. Written to guardians, else the student,
 * as every club message is, and the form says who before anything leaves.
 *
 * **WhatsApp is opened, never sent**: pressing the button records it, and a link
 * per person then appears, because a browser refuses a window opened after a wait.
 * The record says *Aberto no WhatsApp* and never that it arrived.
 */
export function StudentMessages({
  studentId,
  data,
  defaultUntil,
  minUntil,
}: {
  studentId: string;
  data: StudentMessagesData;
  /** The tick's first answer: a week from today. */
  defaultUntil: string;
  minUntil: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(sendStudentMessageAction, INITIAL);
  // A send clears the form; the links stay until the next one.
  const sent = useSuccessKey(state);
  const anyEmail = data.recipients.some((one) => one.hasEmail);
  const anyPhone = data.recipients.some((one) => one.hasPhone);
  const who = data.recipients
    .map((one) => (one.isGuardian ? t('studentMessages.guardian', { name: one.name }) : one.name))
    .join(', ');
  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <h2 className={HEADING}>{t('studentMessages.write')}</h2>
        <p className="text-sm">{t('studentMessages.to', { who })}</p>
        {!data.emailConfigured && <p className="text-sm text-foreground-muted">{t('studentMessages.emailOff')}</p>}
        {!anyEmail && <p className="text-sm text-foreground-muted">{t('studentMessages.noEmail')}</p>}
        {!anyPhone && <p className="text-sm text-foreground-muted">{t('studentMessages.noPhone')}</p>}
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="studentId" value={studentId} />
          <Fields
            key={sent}
            fields={state.fields}
            defaultUntil={defaultUntil}
            minUntil={minUntil}
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
        </form>
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
      </section>

      <section className={CARD}>
        <h2 className={HEADING}>{t('studentMessages.history')}</h2>
        {data.messages.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('studentMessages.none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.messages.map((message) => (
              <li key={message.id} className="flex flex-col gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <ChannelIcon channel={message.channel} />
                  {message.subject}
                </span>
                <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                <p className="text-sm text-foreground-muted">
                  {t('studentMessages.line', {
                    state: stateOf(message, t),
                    when: formatStamp(message.sentAt),
                    who: message.sentByName ?? t('studentMessages.someone'),
                  })}
                </p>
                {message.recipients.length > 0 && (
                  <p className="text-sm text-foreground-muted">
                    {t('studentMessages.toLine', { who: message.recipients.join(', ') })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Keyed on the last send, so a send starts an empty form. */
function Fields({
  fields,
  defaultUntil,
  minUntil,
}: {
  fields: Record<string, string> | undefined;
  defaultUntil: string;
  minUntil: string;
}): React.ReactElement {
  const t = useTranslations();
  const [showInApp, setShowInApp] = useSeeded<boolean>(false);
  const [until, setUntil] = useSeeded<string>(defaultUntil);
  const error = (name: string): string | undefined =>
    fields?.[name] === undefined ? undefined : t(fields[name] as never);
  return (
    <>
      <TextField
        name="subject"
        label={t('studentMessages.subject')}
        required
        maxLength={200}
        {...(error('subject') === undefined ? {} : { error: error('subject') as string })}
      />
      <TextAreaField
        name="body"
        label={t('studentMessages.body')}
        required
        rows={5}
        {...(error('body') === undefined ? {} : { error: error('body') as string })}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="showInApp"
          checked={showInApp}
          onChange={(event) => setShowInApp(event.target.checked)}
          className="size-4"
        />
        {t('studentMessages.showInApp')}
      </label>
      {showInApp && (
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          {t('studentMessages.until')}
          <input
            type="date"
            name="shownUntil"
            required
            min={minUntil}
            value={until}
            onChange={(event) => setUntil(event.target.value)}
            className="h-control rounded-sm border border-border-strong bg-background px-2 text-control"
          />
          {error('shownUntil') !== undefined && <span className="text-danger">{error('shownUntil')}</span>}
        </label>
      )}
    </>
  );
}

function ChannelIcon({ channel }: { channel: StudentMessagesData['messages'][number]['channel'] }): React.ReactElement {
  if (channel === 'email') return <Mail aria-hidden className="size-4 text-foreground-muted" />;
  if (channel === 'whatsapp') return <MessageCircle aria-hidden className="size-4 text-foreground-muted" />;
  return <Smartphone aria-hidden className="size-4 text-foreground-muted" />;
}

function stateOf(
  message: StudentMessagesData['messages'][number],
  t: ReturnType<typeof useTranslations>,
): string {
  if (message.channel === 'whatsapp') return t('studentMessages.state.whatsapp');
  if (message.channel === 'app') return t('studentMessages.state.app', { date: formatDate(message.shownUntil) });
  return message.deliveredCount >= message.addressCount
    ? t('studentMessages.state.delivered')
    : t('studentMessages.state.waiting', { done: message.deliveredCount, total: message.addressCount });
}
