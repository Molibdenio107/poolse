import { redirect } from 'next/navigation';
import { ApiError, apiFetch, type Me } from '@/lib/api';
import { resolveLandingRoute } from '@/lib/landing';

/**
 * Where a bare sign-in lands — POOLSE-37.
 *
 * A route whose only job is to decide. Clerk hands off here when there is no
 * deep link to honour, and this resolves the destination **server-side**, where
 * the roles are already known — rather than after a client render, which would
 * flash a page the person may not be allowed to see.
 *
 * **It is not a page anybody stays on**, which is what makes 37.8's redirect
 * loop impossible: it always sends somebody somewhere else, and never to itself.
 *
 * Somebody in no organization goes to the dashboard, because that is where the
 * "create your organization" form is. Sending them into a section they cannot
 * open would be the permission error AC5 forbids.
 */
export default async function StartPage(): Promise<never> {
  let me: Me | null = null;

  try {
    me = await apiFetch<Me>('/me');
  } catch (error) {
    // A failure here must not strand somebody on a blank screen. The dashboard
    // renders its own error and offers a way forward, so it is the safe landing.
    if (!(error instanceof ApiError)) throw error;
  }

  const membership = me?.memberships[0] ?? null;
  if (membership === null) redirect('/dashboard');

  redirect(resolveLandingRoute(membership.roles));
}
