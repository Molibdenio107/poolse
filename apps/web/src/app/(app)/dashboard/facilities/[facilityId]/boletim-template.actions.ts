'use server';

import { revalidatePath } from 'next/cache';
import type { BoletimPlacement } from '@poolse/rules';
import { apiDelete, apiFetch, apiFileResponse, apiPut } from '@/lib/api';
import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { readAiReaderGate } from '@/lib/ai-meter';
import { readBoletimLayout } from '@/lib/boletim-template-agent';
import { describeFailure } from '@/lib/form-failure';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from '../../actions';

/** The club's own boletim de sócio — POOLSE-142. */
export interface BoletimTemplate {
  id: string;
  fileId: string;
  fields: BoletimPlacement[];
}

export async function readBoletimTemplate(): Promise<Outcome<{ template: BoletimTemplate | null }>> {
  return outcome(apiFetch<{ template: BoletimTemplate | null }>('/settings/boletim-template'));
}

/**
 * The placements, saved as a set. They travel as one JSON field because the
 * editor holds them as a list, not as form boxes; the API judges every one.
 */
export async function saveBoletimFieldsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let fields: unknown;
  try {
    fields = JSON.parse(String(formData.get('fields') ?? '[]'));
  } catch {
    return { ok: false, errorKey: 'boletimTemplate.saveFailed' };
  }
  try {
    await apiPut('/settings/boletim-template/fields', { fields });
  } catch (error) {
    return describeFailure(error, 'boletimTemplate.saveFailed');
  }
  // Every site's *Dados do clube* shows the club's one template.
  revalidatePath('/dashboard/facilities', 'layout');
  return { ok: true };
}

/** What *Propor posições* answers: the model's placements, or why there are none. */
export interface ProposalState {
  ok: boolean;
  proposal?: BoletimPlacement[];
  /** A gate that closed or a read that failed — said where the button is (POOLSE-137). */
  note?: 'off' | 'noKey' | 'capReached' | 'unreadable' | 'nothingFound' | 'notAllowed' | 'rateLimited';
}

/**
 * The model proposes where each field goes on the club's form — POOLSE-142
 * slice B. Nothing is saved: the editor loads the proposal for a person to
 * adjust and save. The form is read back from storage through the API, which
 * checks the reader may open it.
 */
export async function proposeBoletimFieldsAction(_previous: ProposalState): Promise<ProposalState> {
  const blocked = await readAiReaderGate('boletim_template');
  if (blocked !== null) return { ok: false, note: blocked };
  const refused = await guardAiCall(AI_ROLES.boletimTemplate);
  if (refused !== null) return { ok: false, note: refused === 'notAllowed' ? 'notAllowed' : 'rateLimited' };

  const loaded = await readBoletimTemplate();
  if (loaded.state !== 'ok' || loaded.data.template === null) return { ok: false, note: 'unreadable' };
  const file = await apiFileResponse(`/files/${loaded.data.template.fileId}`);
  if (!file.ok) return { ok: false, note: 'unreadable' };
  const mediaType = (file.headers.get('content-type') ?? '').split(';')[0]!.trim();
  const read = await readBoletimLayout(Buffer.from(await file.arrayBuffer()), mediaType);
  if ('error' in read) return { ok: false, note: read.error };
  return { ok: true, proposal: read.placements };
}

/** Takes the template away: the print goes back to Poolse's own boletim. */
export async function removeBoletimTemplateAction(_previous: FormState): Promise<FormState> {
  try {
    await apiDelete('/settings/boletim-template');
  } catch (error) {
    return describeFailure(error, 'boletimTemplate.saveFailed');
  }
  revalidatePath('/dashboard/facilities', 'layout');
  return { ok: true, toastKey: 'boletimTemplate.removed' };
}
