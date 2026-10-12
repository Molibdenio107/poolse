import 'server-only';
import { cache } from 'react';
import { apiFetch } from './api';

/**
 * Whether this installation has file storage configured — once per request.
 *
 * A machine with no bucket (a fresh dev clone, the free pilot before R2 is set
 * up) keeps every upload control visible and plainly switched off, with the
 * reason in words. A failed check answers "configured": the upload itself then
 * says what went wrong, rather than a control being disabled for a reason that
 * is not true.
 */
export const storageConfigured = cache(async (): Promise<boolean> => {
  try {
    return (await apiFetch<{ configured: boolean }>('/files/status')).configured;
  } catch {
    return true;
  }
});
