/**
 * Where a stored file is read — 12 October 2026.
 *
 * Always through the app (`app/(app)/files/[id]/route.ts`), never a bucket URL:
 * the API checks the reader's permission on every request.
 */
export function fileUrl(fileId: string | null | undefined): string | null {
  return fileId === null || fileId === undefined ? null : `/files/${fileId}`;
}

/**
 * What an upload is attached to, as the one string the upload action reads.
 *
 * `kind:id[:id]` — the action turns it into the API route; the API checks the
 * caller may write there, so a hand-edited target is refused there, not trusted.
 */
export type FileTarget =
  | `facility-photo:${string}`
  | `pool-photo:${string}`
  | `policy:${string}:${string}`
  | `agreement:${string}`
  | `qualification:${string}`
  /** `medical-certificate:<student>:<leave>` — POOLSE-109. */
  | `medical-certificate:${string}:${string}`
  | 'logo';

export type FilePurpose =
  | 'policy_document'
  | 'qualification_document'
  | 'agreement_document'
  | 'facility_photo'
  | 'pool_photo'
  | 'logo'
  | 'medical_certificate';

export function purposeOf(target: FileTarget): FilePurpose {
  if (target === 'logo') return 'logo';
  const kind = target.split(':')[0];
  switch (kind) {
    case 'facility-photo':
      return 'facility_photo';
    case 'pool-photo':
      return 'pool_photo';
    case 'policy':
      return 'policy_document';
    case 'agreement':
      return 'agreement_document';
    case 'medical-certificate':
      return 'medical_certificate';
    default:
      return 'qualification_document';
  }
}

/** Photographs and the logo are images, shrunk in the browser before upload. */
export function isImagePurpose(purpose: FilePurpose): boolean {
  return purpose === 'facility_photo' || purpose === 'pool_photo' || purpose === 'logo';
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A Word document — accepted for a partnership's contract only (POOLSE-105). */
export const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * What the picker offers for a purpose. The API judges the bytes either way;
 * this only spares somebody choosing a file that will be refused.
 */
export function acceptFor(purpose: FilePurpose): string {
  if (isImagePurpose(purpose)) return 'image/jpeg,image/png,image/webp';
  const documents = 'application/pdf,image/jpeg,image/png,image/webp';
  return purpose === 'agreement_document' ? `${documents},.docx,${WORD_TYPE}` : documents;
}
