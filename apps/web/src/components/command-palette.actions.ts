'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACTIVE_ORG_COOKIE, apiFetch, type Me } from '@/lib/api';

/** `GET /search` — POOLSE-235. A name and one context fact per row, never what matched. */
export interface PaletteSearch {
  students: { id: string; name: string; level: string | null }[];
  guardians: { id: string; name: string; studentId: string; of: string }[];
  staff: { id: string; name: string; role: string }[];
  turmas: { id: string; name: string; level: string | null; instructor: string | null }[];
}

/**
 * Ctrl+K's data search, through the Next server so the session token never
 * reaches the browser (as every `apiFetch`). The API refuses anybody but the
 * office and instructors and scopes the rest; a refusal or a failure is simply
 * no data results, and the palette keeps its pages.
 */
export async function searchPaletteAction(query: string): Promise<PaletteSearch | null> {
  const term = query.trim();
  if (term.length < 2 || term.length > 100) return null;
  return apiFetch<PaletteSearch>(`/search?q=${encodeURIComponent(term)}`).catch(() => null);
}

/**
 * Switches this browser to another club the reader belongs to — POOLSE-235's
 * *Clubes*. Only a club in the reader's own `/me` is accepted; the API checks
 * the membership again on every request the cookie names (`TenantMiddleware`).
 * Never under a view: a view is one club's.
 */
export async function switchClubAction(organizationId: string): Promise<void> {
  const me = await apiFetch<Me>('/me').catch(() => null);
  if (me === null || me.viewing != null) return;
  if (!me.memberships.some((membership) => membership.organizationId === organizationId)) return;
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  });
  redirect('/dashboard/welcome');
}
