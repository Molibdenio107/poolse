'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPost, type RedemptionOption } from '../../../../../lib/api';

/**
 * Booking a reposição — POOLSE-21.
 *
 * Server actions rather than a fetch from the browser, for the standing reason:
 * the Clerk session token stays on the server and there is no CORS surface to
 * keep in step across two environments.
 */

/**
 * Where this credit could be spent.
 *
 * Fetched on demand — a student with four credits would otherwise cost four
 * eligibility queries on every load of a record most people open to read a phone
 * number.
 *
 * Null on failure rather than a thrown error, so an error boundary does not
 * swallow the whole student record over a list — and null rather than an empty
 * list, because the caller renders an empty list as "no classes available".
 * That is a confident answer, and a request that failed has not earned one.
 */
export async function optionsForCreditAction(
  organizationId: string,
  creditId: string,
): Promise<RedemptionOption[] | null> {
  try {
    const result = await apiFetch<{ options: RedemptionOption[] }>(
      `/credits/${creditId}/options`,
      { organizationId },
    );
    return result.options;
  } catch {
    return null;
  }
}

export type BookResult = { ok: true } | { ok: false; errorKey: string };

/**
 * Spends the credit.
 *
 * The 409 is the interesting case and it is not an error the family made: the
 * last place went while they were choosing. It gets its own message, because
 * "something went wrong" would send somebody to ring the office about a race
 * they can simply lose again by picking another date.
 */
export async function bookCreditAction(
  organizationId: string,
  studentId: string,
  creditId: string,
  sessionId: string,
): Promise<BookResult> {
  try {
    await apiPost(`/credits/${creditId}/book`, { sessionId }, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'reposicao.placeGone' };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'reposicao.notYours' };
    }
    return { ok: false, errorKey: 'reposicao.bookFailed' };
  }

  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

/**
 * Gives the place back.
 *
 * The credit returns to available with its **original expiry**, which the API
 * guarantees — a family cannot stretch a credit by booking and cancelling.
 *
 * A failure is said, not swallowed: the booking still being there afterwards
 * is the truth, but on its own it reads as a button that did nothing.
 */
export async function cancelBookingAction(
  organizationId: string,
  studentId: string,
  bookingId: string,
): Promise<BookResult> {
  try {
    await apiPost(`/bookings/${bookingId}/cancel`, {}, { organizationId });
  } catch {
    return { ok: false, errorKey: 'reposicao.cancelFailed' };
  }
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}
