'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from './actions';

/**
 * Archiving a lesson feedback — POOLSE-116, owner and admin. The bin brings it
 * back, and the toast offers *Anular* through it (POOLSE-78).
 */
export async function archiveFeedbackAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const feedbackId = String(formData.get('feedbackId') ?? '');
  const path = String(formData.get('path') ?? '');
  let archived: { archiveEntryId: string };
  try {
    archived = await apiPost<{ archiveEntryId: string }>(`/feedback/${feedbackId}/archive`, {});
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'feedback.notPermitted' };
    return { ok: false, errorKey: 'feedback.archiveFailed' };
  }
  if (path.startsWith('/dashboard/')) revalidatePath(path);
  return { ok: true, undo: archived.archiveEntryId, toastKey: 'archive.archived.lesson_feedback' };
}
