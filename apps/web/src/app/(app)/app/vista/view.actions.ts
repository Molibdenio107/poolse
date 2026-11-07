'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch, apiPost, type Me } from '@/lib/api';
import { HOME_CHOICE_COOKIE, HOME_PATH, hatsOf, homeChoice, type AppHat } from '@/lib/app-hats';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '@/app/(app)/dashboard/actions';

/**
 * The first screen of the app for an owner, an admin or support — POOLSE-188.
 *
 * A way in of their own (*Backoffice*, or a home they hold) is remembered on this
 * device, for this person: a cookie holding their membership id, so a second login
 * on the same phone is asked again. It decides nothing about access. A view is a
 * row on the server, and these actions only ask for one.
 *
 * A home of their own is **not a view**: it is the reader working as themselves,
 * with their own saves, and it leaves their other devices alone. That is the
 * pilot's shape (Rui, 07-11-2026): Owner on the desktop, teacher on the phone.
 */
async function remember(value: string): Promise<void> {
  const store = await cookies();
  store.set(HOME_CHOICE_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function chooseBackofficeAction(): Promise<void> {
  const me = await apiFetch<Me>('/me');
  const membershipId = me.memberships[0]?.membershipId;
  if (membershipId !== undefined) await remember(homeChoice(membershipId, null));
  redirect('/dashboard');
}

export async function chooseOwnHomeAction(hat: AppHat): Promise<void> {
  const me = await apiFetch<Me>('/me');
  const membership = me.memberships[0];
  if (membership === undefined || !hatsOf(membership.roles).homes.includes(hat)) redirect('/app/vista');
  await remember(homeChoice(membership.membershipId, hat));
  redirect(HOME_PATH[hat]);
}

export async function startViewAction(
  hat: string,
  membershipId: string,
  reason: string,
): Promise<FormState> {
  try {
    await apiPost('/app-view', { hat, membershipId, reason });
  } catch (error) {
    return describeFailure(error, 'appView.startFailed');
  }
  redirect('/app');
}

/** *Sair*, back to the choice. A view that already ran out has nothing to close. */
export async function leaveViewAction(): Promise<void> {
  try {
    await apiPost('/app-view/leave', {});
  } catch {
    // The row decides: if it is still live the banner is still there to press.
  }
  redirect('/app/vista');
}
