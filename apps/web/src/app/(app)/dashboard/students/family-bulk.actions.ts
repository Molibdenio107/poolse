'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../actions';

/**
 * *Convidar famílias* — POOLSE-129. Preview and send are one endpoint with a
 * `commit` flag, so the figures confirmed are the figures the send works from.
 */

export interface BulkFigures {
  students: number;
  byEmail: number;
  phoneOnly: number;
  inApp: number;
  alreadyInvited: number;
  sentToday: number;
  ceiling: number;
  sent: number;
}

export interface BulkState extends FormState {
  figures?: BulkFigures;
  committed?: boolean;
}

function body(formData: FormData, commit: boolean): Record<string, unknown> {
  return {
    search: String(formData.get('search') ?? ''),
    levelId: String(formData.get('levelId') ?? ''),
    commit,
  };
}

export async function previewFamilyInvitesAction(_previous: BulkState, formData: FormData): Promise<BulkState> {
  try {
    const figures = await apiPost<BulkFigures>('/family-invitations/bulk', body(formData, false));
    // Not a save: no toast for a preview.
    return { ok: false, figures };
  } catch (error) {
    return failed(error);
  }
}

export async function sendFamilyInvitesAction(_previous: BulkState, formData: FormData): Promise<BulkState> {
  try {
    const figures = await apiPost<BulkFigures>('/family-invitations/bulk', body(formData, true));
    revalidatePath('/dashboard/students');
    return {
      ok: true,
      committed: true,
      figures,
      toastKey: 'familyBulk.toast',
      values: { count: figures.sent },
    };
  } catch (error) {
    return failed(error);
  }
}

function failed(error: unknown): BulkState {
  if (error instanceof ApiError && error.code === 'invitation_ceiling') {
    const record = (error.details ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      errorKey: 'familyBulk.ceiling',
      values: {
        ceiling: Number(record['ceiling'] ?? 0),
        sentToday: Number(record['sentToday'] ?? 0),
        asked: Number(record['asked'] ?? 0),
      },
    };
  }
  if (error instanceof ApiError && error.status < 500) return { ok: false, errorKey: 'familyBulk.failed' };
  return { ok: false, errorKey: 'common.noAnswer' };
}

/**
 * *Convidar aluno* — POOLSE-129 follow-up (Rui, 30-10-2026): somebody not yet
 * on the register. The API creates the student and invites them in one go.
 */
export interface InviteStudentState extends FormState {
  link?: string;
  studentId?: string;
  /** Somebody in the club already holds this contact: their record, if a student. */
  existingStudentId?: string | null;
  email?: string | null;
}

export async function inviteNewStudentAction(
  _previous: InviteStudentState,
  formData: FormData,
): Promise<InviteStudentState> {
  try {
    const issued = await apiPost<{ studentId: string; link: string; email: string | null; emailed: boolean }>(
      '/family-invitations/new-student',
      {
        firstName: String(formData.get('firstName') ?? ''),
        lastName: String(formData.get('lastName') ?? ''),
        phone: String(formData.get('phone') ?? ''),
        email: String(formData.get('email') ?? ''),
      },
    );
    revalidatePath('/dashboard/students');
    return {
      ok: true,
      link: issued.link,
      studentId: issued.studentId,
      email: issued.email,
      toastKey: issued.emailed
        ? 'familyAccess.toast.emailed'
        : issued.email === null
          ? 'familyAccess.toast.linkReady'
          : 'familyAccess.toast.notEmailed',
      ...(issued.email === null ? {} : { values: { email: issued.email } }),
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'person_exists') {
      const record = (error.details ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        errorKey: 'inviteStudent.exists',
        values: { name: typeof record['name'] === 'string' ? record['name'] : '' },
        fields: { email: 'inviteStudent.exists' },
        existingStudentId: typeof record['studentId'] === 'string' ? record['studentId'] : null,
      };
    }
    if (error instanceof ApiError && error.status < 500) {
      const fields = Object.keys(error.fields).length > 0 ? error.fields : undefined;
      return {
        ok: false,
        errorKey: fields === undefined ? 'inviteStudent.failed' : Object.values(fields)[0]!,
        ...(fields === undefined ? {} : { fields }),
      };
    }
    if (error instanceof ApiError) return { ok: false, errorKey: 'inviteStudent.failed' };
    return { ok: false, errorKey: 'common.noAnswer' };
  }
}
