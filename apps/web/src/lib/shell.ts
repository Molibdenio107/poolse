import 'server-only';
import { cache } from 'react';
import { apiFetch, type SupportStatus } from './api';
import type { Attention } from './attention';
import type { SubscriptionAlertView } from './subscription-alert';

/**
 * What the shell draws beyond `/me` — POOLSE-172. Each part is `null` when there
 * is nothing to draw: not this reader's, or it failed.
 */
export interface Shell {
  logoFileId: string | null;
  attention: Attention | null;
  meetInboxPending: number | null;
  subscriptionAlert: SubscriptionAlertView | null;
  supportStatus: SupportStatus | null;
}

const NOTHING: Shell = {
  logoFileId: null,
  attention: null,
  meetInboxPending: null,
  subscriptionAlert: null,
  supportStatus: null,
};

/**
 * `GET /shell`, once per request (`cache`), shared by the layout and any page
 * that reads the circles. A new thing the shell draws is a part of that route,
 * never another call in the layout. A refusal (a suspended club, a support
 * window that ended) or a failure is nothing to draw, never a broken page.
 */
export const readShell = cache(async (): Promise<Shell> => {
  try {
    return await apiFetch<Shell>('/shell');
  } catch {
    return NOTHING;
  }
});
