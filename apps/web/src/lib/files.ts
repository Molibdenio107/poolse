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
  | 'logo';

export type FilePurpose =
  | 'policy_document'
  | 'qualification_document'
  | 'agreement_document'
  | 'facility_photo'
  | 'pool_photo'
  | 'logo';

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
    default:
      return 'qualification_document';
  }
}

/** Photographs and the logo are images, shrunk in the browser before upload. */
export function isImagePurpose(purpose: FilePurpose): boolean {
  return purpose === 'facility_photo' || purpose === 'pool_photo' || purpose === 'logo';
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
