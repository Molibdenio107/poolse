import 'server-only';
import { cache } from 'react';
import { apiFetch } from './api';

/**
 * Where something needs doing — POOLSE-120. `GET /attention`, read once per
 * request: the layout's menu and the page's own circles share this one call
 * (`cache`). Best effort — a failure is no circles, never a broken page.
 */
export interface Attention {
  menu: Partial<Record<'leads' | 'facilities' | 'calendar', number>>;
  facilities: Record<string, number>;
  pools: Record<string, number>;
  spaces: Record<string, number>;
  sessions: Record<string, number>;
}

const NOTHING: Attention = { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {} };

export const readAttention = cache(async (): Promise<Attention> => {
  try {
    return await apiFetch<Attention>('/attention');
  } catch {
    return NOTHING;
  }
});
