'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  apiPost,
  type ArchiveActor,
  type ArchiveList,
  type ArchiveRestored,
} from '@/lib/api';
import { archiveRefusal } from '@/lib/archive-refusal';
import { describeFailure } from '@/lib/form-failure';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from '../actions';

/**
 * Arquivados — POOLSE-78, slice 2.
 *
 * One restore action for every row, whatever its kind: the API decides what the
 * row takes with it, and the screen only says what came back.
 */

export interface ArchiveQuery {
  kind: string | null;
  actor: string | null;
  from: string | null;
  page: number;
}

export async function listArchive(query: ArchiveQuery): Promise<Outcome<ArchiveList>> {
  const params = new URLSearchParams();
  if (query.kind !== null) params.set('kind', query.kind);
  if (query.actor !== null) params.set('actor', query.actor);
  if (query.from !== null) params.set('from', query.from);
  if (query.page > 1) params.set('page', String(query.page));
  return outcome(apiFetch<ArchiveList>(`/archive${params.size > 0 ? `?${params}` : ''}`));
}

export async function listArchiveActors(): Promise<Outcome<ArchiveActor[]>> {
  return outcome(apiFetch<ArchiveActor[]>('/archive/actors'));
}

export interface RestoreState extends FormState {
  /**
   * Set when the refusal was "its site is archived too", so the row can offer
   * to restore that one instead.
   */
  parentEntryId?: string;
  parentName?: string;
}

/**
 * Restores one archive action. A refusal becomes a sentence with the figures
 * the API sent — `archiveRefusal`, which translates the kind names, because a
 * value handed to `t()` has to be words already.
 */
export async function restoreArchiveAction(
  entryId: string,
  _previous: RestoreState,
  _formData: FormData,
): Promise<RestoreState> {
  return undoArchive(entryId);
}

/** The same restore, called by the toast's *Anular* rather than a form. */
export async function undoArchive(entryId: string): Promise<RestoreState> {
  const t = await getTranslations();

  try {
    const restored = await apiPost<ArchiveRestored>(
      `/archive/${encodeURIComponent(entryId)}/restore`,
      {},
    );
    revalidatePath('/dashboard', 'layout');
    return { ok: true, toastKey: 'archive.restoredToast', values: { name: restored.name } };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const refused = archiveRefusal(error.details, (key) => t(key as never));
      if (refused !== null) return { ok: false, ...refused };
    }
    return describeFailure(error, 'archive.restoreFailed');
  }
}
