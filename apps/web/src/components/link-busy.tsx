'use client';

import { useLinkStatus } from 'next/link';
import { useBusyWhile } from '@/lib/busy';

/**
 * "A carregar…" while the enclosing link's page is on its way — POOLSE-98.
 *
 * The App Router has no route-change event; `useLinkStatus` is the link's own
 * pending state, readable only from inside the `Link`. So this sits inside one
 * and renders nothing. `FromLink` carries it, which covers every in-app link;
 * a plain `Link` that is a way back or a menu entry (`BackLink`, the sidebar,
 * app mode) carries it by hand.
 */
export function LinkBusy(): null {
  const { pending } = useLinkStatus();
  useBusyWhile(pending, 'load');
  return null;
}
