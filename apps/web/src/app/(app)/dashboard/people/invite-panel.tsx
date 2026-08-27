'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InviteForm } from './invite-form';

/**
 * The invite form, folded away behind a button — backlog round 2, story 1.
 *
 * It used to sit open at the top of People, which put a form above the list on
 * every visit for a task an owner does a handful of times a season. The list is
 * what the page is for; the form is an action on it.
 *
 * Revealed inline rather than in a dialog. A dialog would mean a focus trap, an
 * overlay and a scroll lock for a four-field form that has nowhere to hide behind
 * — and this app has no dialog primitive yet, so it would mean owning one.
 * Inline gets the same four things story 1 actually asks for: it opens, it takes
 * focus, Escape closes it, and it comes back empty.
 */
export function InvitePanel({
  organizationId,
  grantableRoles,
}: {
  organizationId: string;
  grantableRoles: string[];
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  /*
   * Bumped on every open, and used as the form's `key`.
   *
   * That is what makes "no stale values from a previous attempt" true rather
   * than nearly true: a new key remounts the subtree, so React discards the
   * field values *and* the `useActionState` result — the error from a rejected
   * duplicate, and the one-time invitation link. Clearing the inputs by hand
   * would have left both of those on screen.
   */
  const [opening, setOpening] = useState(0);

  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back where it came from. Otherwise closing the panel drops the
    // caret at the top of the document and a keyboard user has to tab back down
    // through the whole page to reach the button they just used.
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // The email field is the first thing anyone does here, so it is where focus
    // lands — not on the panel, which would make a screen reader announce a
    // region and then say nothing about what to type.
    panel.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
  }, [open, opening]);

  if (!open) {
    return (
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpening((count) => count + 1);
          setOpen(true);
        }}
        className="self-start rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        {t('invite.open')}
      </button>
    );
  }

  return (
    <div
      ref={panel}
      // Escape from anywhere inside, because focus is inside — the handler is on
      // the container and the event bubbles up to it from whichever field has the
      // caret.
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
      className="flex flex-col gap-4 rounded border border-border bg-surface p-5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('invite.title')}
        </h2>
        <button
          type="button"
          onClick={close}
          className="rounded px-2 py-1 text-sm text-foreground-muted hover:text-foreground"
        >
          {t('common.cancel')}
        </button>
      </div>

      <InviteForm
        key={opening}
        organizationId={organizationId}
        grantableRoles={grantableRoles}
      />
    </div>
  );
}
