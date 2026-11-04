'use server';

import { apiDelete, apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from './actions';

/**
 * The staff board — POOLSE-169. Neither action revalidates: `useSavedAction`
 * raises the toast, then refreshes the page.
 */
export async function pinStaffNoteAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await apiPost<{ id: string }>('/staff-notes', {
      body: String(formData.get('body') ?? ''),
      colour: String(formData.get('colour') ?? 'yellow'),
    });
    return { ok: true, toastKey: 'staffNotes.pinned' };
  } catch (error) {
    return describeFailure(error, 'staffNotes.error.pinFailed');
  }
}

/**
 * Takes a note down. *Anular* is offered only to the office, because the bin
 * it restores through is the office's; an author who is not was asked first.
 */
export async function removeStaffNoteAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('noteId') ?? '');
  try {
    const removed = await apiDelete<{ archiveEntryId: string; undoable: boolean }>(`/staff-notes/${id}`);
    return {
      ok: true,
      toastKey: 'staffNotes.removed',
      ...(removed.undoable ? { undo: removed.archiveEntryId } : {}),
    };
  } catch (error) {
    return describeFailure(error, 'staffNotes.error.removeFailed');
  }
}
