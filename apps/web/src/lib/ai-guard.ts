import 'server-only';
import { apiFetch, type Me } from './api';

/**
 * Who may spend the club's model calls — the sweep of 15 October 2026.
 *
 * Every importer that reads a PDF or matches columns with the model runs in a
 * server action, and a server action is a public endpoint: anybody signed in
 * (a family, an account with no club at all) could post a file to one and the
 * call went to Anthropic before any role was checked, on Poolse's key. The API
 * is where permissions live, but it is not on this path until the commit, so
 * the action asks it first: `/me` names the reader's roles in the club they are
 * acting in, exactly as every page reads them.
 *
 * Then a ceiling per person, because even the right person can loop a form.
 * In memory, per server instance — a cost brake, not an accounting: one
 * Vercel instance forgetting it on a cold start costs a few extra calls.
 */

/** Calls per person in the window. A whole register in PDF is one call. */
const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

const recent = new Map<string, number[]>();

export type AiRefusal = 'notAllowed' | 'tooMany';

/**
 * Null when the reader holds one of `roles` in the active club and has calls
 * left; otherwise why not. Counts the call when it allows it.
 */
export async function guardAiCall(roles: readonly string[]): Promise<AiRefusal | null> {
  let me: Me;
  try {
    me = await apiFetch<Me>('/me');
  } catch {
    return 'notAllowed';
  }

  // `memberships[0]` is the club being acted in — CLAUDE.md, POOLSE-79.
  const membership = me.memberships[0];
  if (membership === undefined || !membership.roles.some((role) => roles.includes(role))) {
    return 'notAllowed';
  }

  const now = Date.now();
  const key = me.user.id;
  const calls = (recent.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (calls.length >= LIMIT) {
    recent.set(key, calls);
    return 'tooMany';
  }
  calls.push(now);
  recent.set(key, calls);
  return null;
}

/** The roles of each importer's own endpoint, so the guard and the API agree. */
export const AI_ROLES = {
  students: ['owner', 'admin'],
  inventory: ['owner', 'admin', 'maintenance'],
  salaries: ['owner', 'admin'],
  partners: ['owner', 'admin'],
  timetable: ['owner', 'admin'],
  water: ['owner', 'admin'],
  energy: ['owner', 'admin', 'maintenance'],
  // POOLSE-85: whoever may type an entry time may import one.
  qualifying: ['owner', 'admin', 'instructor'],
} as const satisfies Record<string, readonly string[]>;
