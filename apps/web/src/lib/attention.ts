import 'server-only';
import { cache } from 'react';
import { readShell } from './shell';

/**
 * Where something needs doing — POOLSE-120, read once per request: the layout's
 * menu and the page's own circles share `readShell`'s one call. Best effort — a
 * failure is no circles, never a broken page.
 */
export interface Attention {
  menu: Partial<Record<'leads' | 'facilities' | 'calendar', number>>;
  facilities: Record<string, number>;
  pools: Record<string, number>;
  spaces: Record<string, number>;
  sessions: Record<string, number>;
}

const NOTHING: Attention = { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {} };

export const readAttention = cache(async (): Promise<Attention> => (await readShell()).attention ?? NOTHING);
