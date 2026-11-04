'use server';

import { apiDelete, apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * Avisos — POOLSE-166. Posting is the API's one call; the window and the words
 * are judged there, and a refusal names its field. Neither action revalidates:
 * `useSavedAction` raises the toast, then refreshes the page.
 */
export async function postAvisoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const audience = String(formData.get('audience') ?? '');
  const targetId = String(formData.get('targetId') ?? '');
  try {
    const posted = await apiPost<{ studentCount: number }>('/avisos', {
      audience,
      ...(audience === 'organization' || targetId === '' ? {} : { targetId }),
      subject: String(formData.get('subject') ?? ''),
      body: String(formData.get('body') ?? ''),
      shownFrom: String(formData.get('shownFrom') ?? ''),
      shownUntil: String(formData.get('shownUntil') ?? ''),
    });
    return { ok: true, toastKey: 'avisos.posted', values: { count: posted.studentCount } };
  } catch (error) {
    return describeFailure(error, 'avisos.error.postFailed');
  }
}

/** Ends an aviso early; the toast's *Anular* brings it back through the bin. */
export async function endAvisoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('avisoId') ?? '');
  try {
    const ended = await apiDelete<{ archiveEntryId: string }>(`/avisos/${id}`);
    return { ok: true, undo: ended.archiveEntryId, toastKey: 'archive.archived.aviso' };
  } catch (error) {
    return describeFailure(error, 'avisos.error.endFailed');
  }
}
