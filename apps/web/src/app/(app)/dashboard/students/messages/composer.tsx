'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { AudienceOptions, MessageAudience } from '@/lib/api';
import {
  previewMessageAction,
  sendMessageAction,
  type PreviewState,
  type SendState,
} from './messages.actions';

/**
 * The composer — POOLSE-67.
 *
 * **Nothing is sent from the form itself.** Rever destinatários asks the API who
 * the message would reach and opens a dialog with the answer; only Enviar in
 * that dialog writes. The count somebody confirms is the count the API resolved,
 * not one this component estimated, and the dialog says before sending — not
 * after — whether email will actually leave.
 *
 * Enviar re-reads the same form rather than carrying the fields in state, so
 * what was typed is what is sent. Every field is controlled (`field.tsx`), so a
 * refused send leaves the words where they were.
 */

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;

export function MessageComposer({
  organizationId,
  options,
  canAddressClub,
  initial,
}: {
  organizationId: string;
  options: AudienceOptions;
  /** Owner and admin. An instructor may write to their own turmas only. */
  canAddressClub: boolean;
  initial: { audience?: string; targetId?: string; subject?: string };
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  const audiences: MessageAudience[] = [
    ...(options.classGroups.length > 0 ? (['class_group'] as const) : []),
    ...(options.levels.length > 0 ? (['level'] as const) : []),
    ...(options.facilities.length > 1 ? (['facility'] as const) : []),
    ...(canAddressClub ? (['organization'] as const) : []),
  ];

  const startAudience = audiences.includes(initial.audience as MessageAudience)
    ? (initial.audience as MessageAudience)
    : (audiences[0] ?? 'class_group');
  const [audience, setAudience] = useState<MessageAudience>(startAudience);

  const targets =
    audience === 'class_group'
      ? options.classGroups
      : audience === 'level'
        ? options.levels
        : audience === 'facility'
          ? options.facilities
          : [];
  const startTarget =
    targets.find((option) => option.id === initial.targetId)?.id ?? targets[0]?.id ?? '';

  const [previewState, preview, previewing] = useActionState<PreviewState, FormData>(
    previewMessageAction.bind(null, organizationId),
    { ok: false },
  );
  const [sendState, send, sending] = useSavedAction<SendState, FormData>(
    sendMessageAction.bind(null, organizationId),
    { ok: false },
  );

  const [open, setOpen] = useState(false);

  // A fresh preview opens the dialog; identity, so it opens once per answer.
  const seenPreview = useRef(previewState);
  useEffect(() => {
    if (seenPreview.current === previewState) return;
    seenPreview.current = previewState;
    if (previewState.ok) setOpen(true);
  }, [previewState]);

  // A send that worked goes to the record; one that failed comes back to the
  // form, where a field error is drawn beside its field.
  const seenSend = useRef(sendState);
  useEffect(() => {
    if (seenSend.current === sendState) return;
    seenSend.current = sendState;
    setOpen(false);
    if (sendState.ok && sendState.id) router.push(`/dashboard/students/messages/${sendState.id}`);
  }, [sendState, router]);

  if (audiences.length === 0) {
    return (
      <section className="flex flex-col gap-1 rounded border border-border bg-surface p-5">
        <p className="font-medium">{t('messages.compose.nothingToAddress')}</p>
        <p className="text-sm text-foreground-muted">{t('messages.compose.nothingToAddressHint')}</p>
      </section>
    );
  }

  const fieldError = (name: string): string | undefined => {
    const key = sendState.fields?.[name] ?? previewState.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  const result = previewState.preview;

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <form id={formId} ref={form} action={preview} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <SelectField
            name="audience"
            label={t('messages.field.audience')}
            initial={startAudience}
            options={audiences.map((value) => ({
              value,
              label: t(`messages.audience.${value}`),
            }))}
            onValueChange={(value) => setAudience(value as MessageAudience)}
            error={fieldError('audience')}
          />
          {audience !== 'organization' && (
            <SelectField
              // A new list is a new control: remount so it starts on an option
              // that exists in it rather than on the last list's choice.
              key={audience}
              name="targetId"
              label={t(`messages.field.target.${audience}`)}
              initial={startTarget}
              options={targets.map((option) => ({
                value: option.id,
                label: option.detail === null ? option.name : `${option.name} · ${option.detail}`,
              }))}
              error={fieldError('targetId')}
            />
          )}
        </div>

        <TextField
          name="subject"
          label={t('messages.field.subject')}
          initial={initial.subject ?? ''}
          maxLength={SUBJECT_MAX}
          required
          error={fieldError('subject')}
          className="max-w-form"
        />
        <TextAreaField
          name="body"
          label={t('messages.field.body')}
          rows={8}
          maxLength={BODY_MAX}
          required
          hint={t('messages.field.bodyHint')}
          error={fieldError('body')}
        />

        {previewState.ok === false && previewState.errorKey !== undefined && (
          <p className="text-sm text-danger" role="alert">
            {t(previewState.errorKey as never)}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={previewing || sending}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {previewing ? t('messages.compose.checking') : t('messages.compose.review')}
          </button>
        </div>
      </form>

      <Dialog
        open={open && result !== undefined}
        onClose={() => setOpen(false)}
        title={t('messages.confirm.title')}
        closeLabel={t('common.close')}
        initialFocus={confirm}
      >
        {result !== undefined && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              {t('messages.confirm.reach', {
                addresses: result.addressCount,
                students: result.studentCount,
              })}
            </p>

            {result.unreachable.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {t('messages.confirm.unreachable', { count: result.unreachable.length })}
                </p>
                <p className="text-foreground-muted">
                  {result.unreachable.map((student) => student.name).join(', ')}
                </p>
              </div>
            )}

            {!result.emailConfigured && (
              <p className="rounded border border-border bg-surface-muted p-3">
                {t('messages.confirm.notConfigured')}
              </p>
            )}

            {result.addressCount === 0 ? (
              <p className="font-medium">{t('messages.error.noRecipients')}</p>
            ) : null}

            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-border px-4 py-2 hover:bg-surface-muted"
              >
                {t('common.cancel')}
              </button>
              {result.addressCount > 0 && (
                <button
                  ref={confirm}
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    if (form.current === null) return;
                    const data = new FormData(form.current);
                    startTransition(() => send(data));
                  }}
                  className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
                >
                  {sending
                    ? t('messages.confirm.sending')
                    : t('messages.confirm.send', { addresses: result.addressCount })}
                </button>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
