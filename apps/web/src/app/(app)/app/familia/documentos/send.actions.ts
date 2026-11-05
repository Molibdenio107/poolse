'use server';

import { ApiError, apiUpload } from '@/lib/api';
import type { FormState } from '../../../dashboard/actions';

const KINDS = ['fpn_declaration', 'socio_form', 'id_document', 'medical_exam'] as const;
const ID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The API's refusals, each with its own sentence. */
const REFUSED: Record<string, string> = {
  file_type: 'app.documents.send.refused.fileType',
  file_too_large: 'app.documents.send.refused.tooLarge',
  file_empty: 'app.documents.send.refused.empty',
  exam_date: 'app.documents.send.refused.examDate',
  already_sent: 'app.documents.send.refused.alreadySent',
  minor_reads_only: 'app.documents.send.refused.guardianSends',
  no_season: 'app.documents.send.refused.noSeason',
};

/**
 * A family sends a document — POOLSE-179 slice 2. The API checks whose child,
 * which papers this child's sports ask for, the file's real type (a HEIC is
 * turned into a JPEG there), and that nothing of this kind is already waiting.
 * This only carries the file and says the answer in words.
 */
export async function sendDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const child = String(formData.get('child') ?? '');
  const kind = String(formData.get('kind') ?? '');
  const examinedOn = String(formData.get('examinedOn') ?? '');
  const file = formData.get('file');
  if (!ID.test(child) || !(KINDS as readonly string[]).includes(kind)) return { ok: false, errorKey: 'app.documents.send.failed' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, errorKey: 'app.documents.send.refused.empty' };
  if (kind === 'medical_exam' && !DAY.test(examinedOn)) return { ok: false, errorKey: 'app.documents.send.refused.examDate' };

  const query = new URLSearchParams({ child, name: file.name.slice(0, 200) });
  if (kind === 'medical_exam') query.set('examinedOn', examinedOn);
  try {
    await apiUpload(`/app/documents/${kind}?${query.toString()}`, await file.arrayBuffer());
  } catch (error) {
    const refused = error instanceof ApiError && typeof error.code === 'string' ? REFUSED[error.code] : undefined;
    if (refused !== undefined) return { ok: false, errorKey: refused };
    if (error instanceof ApiError && error.status === 429) return { ok: false, errorKey: 'app.documents.send.refused.tooMany' };
    return { ok: false, errorKey: 'app.documents.send.failed' };
  }
  // No revalidatePath: it would unmount this form before its toast. `useSavedAction` refreshes after it.
  return { ok: true, toastKey: 'app.documents.send.sent' };
}
