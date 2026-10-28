import { fileUrl } from './files';

/**
 * Where a student's photograph loads from — Rui, 28-10-2026.
 *
 * Through the app (`/files/<id>`), like every stored file, and never a bucket
 * URL: the API checks the reader on every request, including that the photo
 * consent still stands. The id reaching this function has already passed the
 * consent gate in the SQL that produced it — see PHOTO_KEY in the students
 * repository — and the read checks it again, so a withdrawal is never a cached
 * link away from being ignored.
 */
export function photoUrlFor(fileId: string | null): string | null {
  return fileUrl(fileId);
}
