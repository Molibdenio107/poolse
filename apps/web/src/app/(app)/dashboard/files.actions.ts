'use server';

import { ApiError, apiDelete, apiPost, apiPut, apiUpload } from '../../../lib/api';
import { MAX_FILE_BYTES, purposeOf, type FileTarget } from '../../../lib/files';
import type { FormState } from './actions';

/**
 * Uploading a file and attaching it — 12 October 2026.
 *
 * One action for every place a file goes: the bytes go to `POST /files` for the
 * target's purpose, then the returned id is attached by the feature's own
 * route. The API checks both steps; `target` only says where to send them.
 */
export async function uploadFileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const target = String(formData.get('target') ?? '') as FileTarget;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, errorKey: 'files.chooseFile' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, errorKey: 'files.tooLarge' };

  const route = attachRoute(target);
  if (route === null) return { ok: false, errorKey: 'files.uploadFailed' };

  try {
    const query = new URLSearchParams({ purpose: purposeOf(target), name: file.name });
    const stored = await apiUpload<{ id: string }>(`/files?${query.toString()}`, await file.arrayBuffer());
    const caption = String(formData.get('caption') ?? '').trim();
    if (route.method === 'POST') {
      await apiPost(route.path, { fileId: stored.id, ...(caption === '' ? {} : { caption }) });
    } else {
      await apiPut(route.path, { fileId: stored.id });
    }
  } catch (error) {
    return refusal(error);
  }
  return { ok: true };
}

/** Takes a document off its record, or the logo off the club. The file stays on record. */
export async function detachFileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const target = String(formData.get('target') ?? '') as FileTarget;
  const route = attachRoute(target);
  if (route === null || route.method !== 'PUT') return { ok: false, errorKey: 'files.uploadFailed' };
  try {
    await apiPut(route.path, { fileId: null });
  } catch (error) {
    return refusal(error);
  }
  return { ok: true };
}

/** Takes a photograph out of a gallery. */
export async function removePhotoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const target = String(formData.get('target') ?? '') as FileTarget;
  const photoId = String(formData.get('photoId') ?? '');
  const route = attachRoute(target);
  if (route === null || route.method !== 'POST' || !/^[0-9a-f-]{36}$/i.test(photoId)) {
    return { ok: false, errorKey: 'files.removeFailed' };
  }
  try {
    await apiDelete(`${route.path}/${photoId}`);
  } catch (error) {
    return refusal(error, 'files.removeFailed');
  }
  return { ok: true };
}

const ID = /^[0-9a-f-]{36}$/i;

function attachRoute(target: FileTarget): { method: 'POST' | 'PUT'; path: string } | null {
  if (target === 'logo') return { method: 'PUT', path: '/settings/logo' };
  const [kind, first = '', second = ''] = target.split(':');
  if (!ID.test(first)) return null;
  switch (kind) {
    case 'facility-photo':
      return { method: 'POST', path: `/facilities/${first}/photos` };
    case 'pool-photo':
      return { method: 'POST', path: `/pools/${first}/photos` };
    case 'policy':
      return ID.test(second)
        ? { method: 'PUT', path: `/facilities/${first}/insurance-policies/${second}/document` }
        : null;
    case 'agreement':
      return { method: 'PUT', path: `/partners/${first}/agreement/document` };
    case 'qualification':
      return { method: 'PUT', path: `/qualifications/${first}/document` };
    default:
      return null;
  }
}

/** The API's refusal codes, each with its own sentence. */
const CODES: Record<string, string> = {
  storage_not_configured: 'files.notConfigured',
  file_type: 'files.wrongType',
  file_too_large: 'files.tooLarge',
  file_empty: 'files.chooseFile',
  qualification_document_set: 'files.certificateAttached',
};

function refusal(error: unknown, fallback = 'files.uploadFailed'): FormState {
  if (error instanceof ApiError) {
    const key = error.code === null ? undefined : CODES[error.code];
    if (key !== undefined) return { ok: false, errorKey: key };
    if (error.status === 403) return { ok: false, errorKey: 'files.notAllowed' };
    if (error.status < 500) return { ok: false, errorKey: fallback };
    return { ok: false, errorKey: fallback, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey: fallback, detail: String(error) };
}
