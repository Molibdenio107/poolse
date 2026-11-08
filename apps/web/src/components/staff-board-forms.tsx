'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, StickyNote, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { TextAreaField, useSuccessKey } from '@/components/ui/field';
import { ConfirmButton } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { pinStaffNoteAction, removeStaffNoteAction } from '@/app/(app)/dashboard/staff-notes.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Novo recado* — POOLSE-169 (Rui, 04-11-2026: "collapse the creation to the
 * top right corner, keep the note itself first"). A small button in the page's
 * header opening the form in a dialog (a bottom sheet on a phone), so the top
 * of the page is the notes and nothing else. It closes after a pin that worked.
 */
export function NewNoteButton({ short = false }: { short?: boolean } = {}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control font-medium shadow-card hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {short ? <Plus aria-hidden className="size-4" /> : <StickyNote aria-hidden className="size-4" />}
        {short ? t('staffNotes.newShort') : t('staffNotes.new')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('staffNotes.new')}
        description={t('staffNotes.hint')}
        closeLabel={t('common.close')}
        placement="sheet"
      >
        <PinNoteForm onPinned={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

/**
 * Writing a post-it — POOLSE-169. Just the words: the paper is the author's role
 * (Rui, 07-11-2026), decided by the server. Cleared after a pin that worked.
 */
function PinNoteForm({ onPinned }: { onPinned: () => void }): React.ReactElement {
  const t = useTranslations();
  const [state, pin, pinning] = useSavedAction(pinStaffNoteAction, INITIAL);
  const fresh = useSuccessKey(state);

  // A pin that worked closes the dialog, once; the toast says so and the page refreshes.
  const seen = useRef(fresh);
  useEffect(() => {
    if (fresh === seen.current) return;
    seen.current = fresh;
    onPinned();
  }, [fresh, onPinned]);

  const error = (name: string): string | undefined => {
    const key = state.ok ? undefined : state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  return (
    <form key={fresh} action={pin} className="flex flex-col gap-3">
      <TextAreaField
        name="body"
        label={t('staffNotes.field')}
        rows={4}
        maxLength={500}
        error={error('body')}
        required
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pinning}
          className="ml-auto inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pinning ? t('staffNotes.pinning') : t('staffNotes.pin')}
        </button>
      </div>
    </form>
  );
}

/** *Tirar* — asks first; the office's toast offers *Anular*. */
export function RemoveNoteButton({ noteId }: { noteId: string }): React.ReactElement {
  const t = useTranslations();
  const [, remove, removing] = useSavedAction(removeStaffNoteAction, INITIAL);
  return (
    <form action={remove} className="absolute right-1 top-1">
      <input type="hidden" name="noteId" value={noteId} />
      <ConfirmButton
        title={t('staffNotes.removeTitle')}
        message={t('staffNotes.removeMessage')}
        confirmLabel={t('staffNotes.remove')}
        tone="danger"
        disabled={removing}
        ariaLabel={t('staffNotes.remove')}
        className="post-it-muted inline-flex size-8 items-center justify-center rounded-sm hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <X aria-hidden className="size-4" />
      </ConfirmButton>
    </form>
  );
}
