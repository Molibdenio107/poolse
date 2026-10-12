'use server';

import { revalidatePath } from 'next/cache';
import {
  apiFetch,
  apiPost,
  type IncidentDetail,
  type IncidentList,
  type PersonSummary,
  type Students,
} from '@/lib/api';
import { outcome, type Outcome } from '@/lib/load-failure';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * Ocorrências — POOLSE-70, slice 1.
 *
 * Nothing here edits an incident, because nothing can: the API holds INSERT and
 * an archive, and a correction is an addendum. Reading the clinical detail is an
 * action rather than part of the page load because every read is logged, and a
 * page that decrypted on render would write an audit row for every refresh and
 * every prefetch.
 */

export interface RecordState extends FormState {
  id?: string;
}

export async function listIncidents(
  facilityId: string,
  page: number,
): Promise<Outcome<IncidentList>> {
  return outcome(
    apiFetch<IncidentList>(
      `/facilities/${encodeURIComponent(facilityId)}/incidents${page > 1 ? `?page=${page}` : ''}`,
    ),
  );
}

function text(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? '').trim();
  return value === '' ? null : value;
}

export async function recordIncidentAction(
  facilityId: string,
  _previous: RecordState,
  formData: FormData,
): Promise<RecordState> {
  // One select names a tank or a space, prefixed so the two cannot be confused;
  // empty is "elsewhere on the site", which the API stores as neither.
  const place = text(formData, 'place') ?? '';
  const kind = text(formData, 'personKind');

  const body = {
    occurredAt: text(formData, 'occurredAt'),
    poolId: place.startsWith('pool:') ? place.slice(5) : null,
    spaceId: place.startsWith('space:') ? place.slice(6) : null,
    // Only the chosen kind's answer is sent, so a name typed for a visitor and
    // then abandoned for a student cannot ride along as a second person.
    studentId: kind === 'student' ? text(formData, 'studentId') : null,
    membershipId: kind === 'member' ? text(formData, 'membershipId') : null,
    visitorName: kind === 'visitor' ? text(formData, 'visitorName') : null,
    emergencyCalled: formData.get('emergencyCalled') === 'on',
    lifeguardMembershipId: text(formData, 'lifeguardMembershipId'),
    policyReference: text(formData, 'policyReference'),
    whatHappened: text(formData, 'whatHappened'),
    injury: text(formData, 'injury'),
    firstAid: text(formData, 'firstAid'),
  };

  try {
    const { id } = await apiPost<{ id: string }>(
      `/facilities/${encodeURIComponent(facilityId)}/incidents`,
      body,
    );
    revalidatePath('/dashboard/facilities/incidents');
    return { ok: true, id };
  } catch (error) {
    return describeFailure(error, 'incidents.error.recordFailed');
  }
}

export type DetailState =
  | { ok: true; detail: IncidentDetail }
  | { ok: false; errorKey: string };

/** One logged read of the clinical detail — the API writes the audit row. */
export async function readIncidentDetailAction(incidentId: string): Promise<DetailState> {
  try {
    const detail = await apiPost<IncidentDetail>(
      `/incidents/${encodeURIComponent(incidentId)}/detail`,
      {},
    );
    return { ok: true, detail };
  } catch (error) {
    const failure = describeFailure(error, 'incidents.error.detailFailed');
    return {
      ok: false,
      errorKey:
        failure.errorKey === 'common.notAllowed'
          ? 'incidents.detailRefused'
          : (failure.errorKey ?? 'incidents.error.detailFailed'),
    };
  }
}

export async function addAddendumAction(
  incidentId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPost(`/incidents/${encodeURIComponent(incidentId)}/addenda`, {
      body: String(formData.get('body') ?? ''),
    });
    revalidatePath(`/dashboard/facilities/incidents/${incidentId}`);
    revalidatePath('/dashboard/facilities/incidents');
    return { ok: true };
  } catch (error) {
    return describeFailure(error, 'incidents.error.addendumFailed');
  }
}

export async function archiveIncidentAction(incidentId: string): Promise<FormState> {
  try {
    await apiPost(`/incidents/${encodeURIComponent(incidentId)}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'incidents.error.archiveFailed');
  }
  revalidatePath('/dashboard/facilities/incidents');
  return { ok: true };
}

/** One row a picker offers: who, and a second line that tells two of a name apart. */
export interface PickOption {
  id: string;
  name: string;
  detail: string | null;
}

/**
 * The pickers ask `/incidents/people`, which answers an id and a name and
 * nothing else — the register and the people search are the office's and the
 * instructors' since the security review of 12 October 2026, and maintenance
 * records incidents too. `null` means the search failed, which the picker says,
 * distinct from an empty list, which means nobody matched.
 */
async function pick(kind: 'student' | 'member' | 'staff', query: string): Promise<PickOption[] | null> {
  try {
    const result = await apiFetch<{ people: { id: string; name: string }[] }>(
      `/incidents/people?kind=${kind}&q=${encodeURIComponent(query)}`,
    );
    return result.people.map((person) => ({ id: person.id, name: person.name, detail: null }));
  } catch {
    return null;
  }
}

/** Students matching what was typed. */
export async function searchStudentsAction(query: string): Promise<PickOption[] | null> {
  return pick('student', query);
}

/** Anybody in the club with a membership — a parent on the deck, a member swimming. */
export async function searchMembersAction(query: string): Promise<PickOption[] | null> {
  return pick('member', query);
}

/** Staff only, for the lifeguard on duty — a teacher can be the lifeguard too. */
export async function searchStaffAction(query: string): Promise<PickOption[] | null> {
  return pick('staff', query);
}
