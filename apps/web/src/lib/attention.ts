import 'server-only';
import { cache } from 'react';
import { readShell } from './shell';

/**
 * Where something needs doing — POOLSE-120, read once per request: the layout's
 * menu and the page's own circles share `readShell`'s one call. Best effort — a
 * failure is no circles, never a broken page.
 */
export interface Attention {
  /** By menu key; a sport's copy is `<key>:<sport>`, so the keys are not a closed set. */
  menu: Record<string, number>;
  facilities: Record<string, number>;
  pools: Record<string, number>;
  spaces: Record<string, number>;
  sessions: Record<string, number>;
  /** Students with something to review — POOLSE-190. */
  students: Record<string, number>;
}

const NOTHING: Attention = { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {}, students: {} };

export const readAttention = cache(async (): Promise<Attention> => (await readShell()).attention ?? NOTHING);
