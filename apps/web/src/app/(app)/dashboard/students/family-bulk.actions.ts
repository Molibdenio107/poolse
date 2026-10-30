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
  return { ok: false, errorKey: 'familyBulk.failed', detail: String(error) };
}
