'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiFetch,
  apiPatch,
  apiPost,
  type SpaceList,
} from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * Espaços — round 6.
 *
 * The same shape the panels around it use: reads return null when the endpoint
 * refuses, so a block that cannot load is absent rather than rendered empty and
 * never costs the whole site page.
 *
 * **Nothing here decides a permission.** Every action posts and lets the API
 * answer; `canManage`, `canLog` and `canResolve` travel with the read purely so
 * the screen can avoid showing a control that would be refused. Hiding a control
 * is never the control — CLAUDE.md, and the reason the server checks anyway.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      const message = (error.details as { message?: string } | null)?.message;
      // Two different 409s, and they read very differently to an operator.
      if (message === 'spaces.issueAlreadyResolved') {
        return { ok: false, errorKey: 'spaces.issueAlreadyResolved' };
      }
      return { ok: false, errorKey: 'spaces.nameTaken' };
    }
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function refreshFacility(facilityId: string): void {
  revalidatePath(`/dashboard/facilities/${facilityId}`);
}

function refreshSpace(spaceId: string): void {
  revalidatePath(`/dashboard/facilities/spaces/${spaceId}`);
}

/**
 * A site's spaces, with each one's last cleaning and open-issue count.
 *
 * Null when the endpoint refuses — the panel is then simply not there, the same
 * way `listPartners` and `listPrices` behave next door.
 */
export async function listSpaces(facilityId: string): Promise<SpaceList | null> {
  return apiFetch<SpaceList>(
    `/spaces?facilityId=${encodeURIComponent(facilityId)}`,
  ).catch(() => null);
}

/**
 * The interval arrives as text from a form and leaves as a number or null.
 *
 * An empty box means "no schedule", which is the default and a real answer — not
 * zero. The API refuses zero explicitly rather than storing it, because a zero
 * interval means permanently overdue and nobody types that on purpose.
 */
function readInterval(form: FormData): number | null | 'invalid' {
  const raw = String(form.get('intervalHours') ?? '').trim();
  if (raw === '') return null;

  const hours = Number(raw);
  if (!Number.isInteger(hours) || hours <= 0) return 'invalid';
  return hours;
}

function spaceBody(form: FormData): Record<string, unknown> | 'invalid' {
  const intervalHours = readInterval(form);
  if (intervalHours === 'invalid') return 'invalid';

  return {
    name: String(form.get('name') ?? '').trim(),
    type: String(form.get('type') ?? 'other'),
    description: String(form.get('description') ?? '').trim(),
    // An unchecked checkbox posts nothing at all, so absence is "out of service"
    // here — the opposite of the API's default, and correct for a form that
    // always renders the box.
    active: form.get('active') !== null,
    intervalHours,
  };
}

export async function createSpace(
  facilityId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const body = spaceBody(form);
  if (body === 'invalid') {
    return { ok: false, fields: { intervalHours: 'spaces.intervalInvalid' } };
  }

  try {
    await apiPost('/spaces', { facilityId, ...body });
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.saveFailed');
  }
}

export async function updateSpace(
  spaceId: string,
  facilityId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const body = spaceBody(form);
  if (body === 'invalid') {
    return { ok: false, fields: { intervalHours: 'spaces.intervalInvalid' } };
  }

  try {
    await apiPatch(`/spaces/${spaceId}`, body);
    refreshSpace(spaceId);
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.saveFailed');
  }
}

export async function archiveSpace(
  spaceId: string,
  facilityId: string,
): Promise<FormState> {
  try {
    await apiPost(`/spaces/${spaceId}/archive`, {});
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.deleteFailed');
  }
}

/**
 * "Marcar como limpo".
 *
 * The note is the only thing that travels. Who and when are the server's — a log
 * whose author could be chosen by the client is worth less than the paper sheet
 * it replaces.
 */
export async function logCleaning(
  spaceId: string,
  facilityId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await apiPost(`/spaces/${spaceId}/cleanings`, {
      note: String(form.get('note') ?? '').trim(),
    });
    refreshSpace(spaceId);
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.cleanFailed');
  }
}

export async function archiveCleaning(
  spaceId: string,
  facilityId: string,
  cleaningId: string,
): Promise<FormState> {
  try {
    await apiPost(`/spaces/${spaceId}/cleanings/${cleaningId}/archive`, {});
    refreshSpace(spaceId);
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.deleteFailed');
  }
}

export async function reportIssue(
  spaceId: string,
  facilityId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await apiPost(`/spaces/${spaceId}/issues`, {
      type: String(form.get('type') ?? ''),
      description: String(form.get('description') ?? '').trim(),
    });
    refreshSpace(spaceId);
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.reportFailed');
  }
}

export async function resolveIssue(
  spaceId: string,
  facilityId: string,
  issueId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await apiPost(`/spaces/${spaceId}/issues/${issueId}/resolve`, {
      note: String(form.get('note') ?? '').trim(),
    });
    refreshSpace(spaceId);
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.resolveFailed');
  }
}

export async function archiveIssue(
  spaceId: string,
  facilityId: string,
  issueId: string,
): Promise<FormState> {
  try {
    await apiPost(`/spaces/${spaceId}/issues/${issueId}/archive`, {});
    refreshSpace(spaceId);
    refreshFacility(facilityId);
    return { ok: true };
  } catch (error) {
    return failure(error, 'spaces.deleteFailed');
  }
}
