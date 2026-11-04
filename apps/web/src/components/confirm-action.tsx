'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';

const SECONDARY =
  'inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const DANGER =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm border border-danger/50 px-4 text-control text-danger hover:bg-danger/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * A decision asks first — Rui, 04-11-2026: "to not let the user do or undo
 * things without asking first".
 *
 * The trigger is an ordinary button that opens the shared `Dialog`; the dialog
 * holds the form, so nothing is posted until *the confirm button* is pressed.
 * Approving, refusing, archiving, restoring, revoking, ending, marking returned
 * or paid — anything a person would regret doing by a stray click — goes
 * through this, so every question looks and behaves the same: the title names
 * the thing, one sentence says what happens, *Cancelar* on the left, the
 * decision on the right (red when it takes something away).
 *
 * It closes itself when the action has run (pending → done), never on submit,
 * so a refusal reaches the toast while the dialog is still there to retry. A
 * typed form a person filled in and saved is not a decision of this kind and
 * does not use it.
 */
export function ConfirmAction({
  action,
  pending,
  fields = {},
  title,
  message,
  confirmLabel,
  tone = 'primary',
  trigger,
  triggerClassName,
  triggerAriaLabel,
  disabled = false,
  placement,
  children,
}: {
  /** What the confirm button submits — usually a `useSavedAction` dispatch. */
  action: (formData: FormData) => void;
  pending: boolean;
  /** Hidden inputs the form posts (ids, the decision). */
  fields?: Record<string, string>;
  title: string;
  /** One sentence: what happens, and whether it can be undone. */
  message: string;
  confirmLabel: string;
  /** `danger` for a decision that takes something away. */
  tone?: 'primary' | 'danger';
  /** The trigger's content — its words, or an icon with `triggerAriaLabel`. */
  trigger: React.ReactNode;
  triggerClassName: string;
  triggerAriaLabel?: string;
  disabled?: boolean;
  placement?: 'centre' | 'sheet';
  /** More fields inside the question (a reason box), posted with it. */
  children?: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  // Closed once the action has finished, not when it was sent.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) setOpen(false);
    wasPending.current = pending;
  }, [pending]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || pending}
        aria-label={triggerAriaLabel}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        closeLabel={t('common.close')}
        className="max-w-md"
        {...(placement === undefined ? {} : { placement })}
      >
        <form action={action} className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <p className="text-sm">{message}</p>
          {children}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pending} className={tone === 'danger' ? DANGER : PRIMARY}>
              {pending ? t('common.working') : confirmLabel}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * The same question, dropped in where a button already is — Rui, 04-11-2026.
 *
 * Replaces a `type="submit"` button inside an existing form, or an `onClick`
 * that runs an action, without restructuring either: the trigger opens the
 * shared question, and the confirm button then submits the trigger's own form
 * (through a hidden submit carrying `name`/`value`, when the old button had
 * them) or calls `onConfirm`. The form, its hidden fields and its action stay
 * exactly where they were.
 */
export function ConfirmButton({
  title,
  message,
  confirmLabel,
  tone = 'primary',
  className,
  ariaLabel,
  disabled = false,
  name,
  value,
  onConfirm,
  placement,
  children,
}: {
  title: string;
  /** One sentence: what happens, and whether it can be undone. */
  message: string;
  confirmLabel: string;
  /** `danger` for a decision that takes something away. */
  tone?: 'primary' | 'danger';
  className: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** The submitter's name and value, when the old submit button carried them. */
  name?: string;
  value?: string;
  /** Called instead of submitting the form — for a button that ran an action itself. */
  onConfirm?: () => void;
  placement?: 'centre' | 'sheet';
  /** The trigger's content — its words, or an icon with `ariaLabel`. */
  children: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const submitter = useRef<HTMLButtonElement>(null);

  const confirm = (): void => {
    setOpen(false);
    if (onConfirm !== undefined) {
      onConfirm();
      return;
    }
    const form = trigger.current?.form;
    if (form === null || form === undefined) return;
    if (submitter.current !== null) form.requestSubmit(submitter.current);
    else form.requestSubmit();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </button>
      {onConfirm === undefined && name !== undefined && (
        <button ref={submitter} type="submit" name={name} value={value} hidden tabIndex={-1} aria-hidden />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        closeLabel={t('common.close')}
        className="max-w-md"
        {...(placement === undefined ? {} : { placement })}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">{message}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={confirm} className={tone === 'danger' ? DANGER : PRIMARY}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
