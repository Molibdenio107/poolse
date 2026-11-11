import 'server-only';
import { cache } from 'react';
import { readShell } from './shell';
import type { AttentionLesson, AttentionPlace } from './attention-items';

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
  /** Turmas with no teacher — POOLSE-211. */
  classGroups?: Record<string, number>;
  /** What the site circles stand for, named — the bell's lines (Rui, 11-11-2026). */
  places?: AttentionPlace[];
  /** The lessons behind the calendar's count, named — the bell's lines. */
  lessons?: AttentionLesson[];
}

const NOTHING: Attention = { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {}, students: {}, places: [], lessons: [] };

export const readAttention = cache(async (): Promise<Attention> => (await readShell()).attention ?? NOTHING);
