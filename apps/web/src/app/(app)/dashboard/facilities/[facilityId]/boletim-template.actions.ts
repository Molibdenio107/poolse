'use server';

import { revalidatePath } from 'next/cache';
import { isTemplateKind, type BoletimPlacement, type TemplateKind } from '@poolse/rules';
import { apiDelete, apiFetch, apiFileResponse, apiPut } from '@/lib/api';
import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { readAiReaderGate } from '@/lib/ai-meter';
import { readBoletimLayout } from '@/lib/boletim-template-agent';
import { describeFailure } from '@/lib/form-failure';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from '../../actions';

/** A club's own form — POOLSE-142: the boletim de sócio or the FPN declaration. */
export interface BoletimTemplate {
  id: string;
  kind: TemplateKind;
  fileId: string;
  fields: BoletimPlacement[];
}

export async function readBoletimTemplate(kind: TemplateKind): Promise<Outcome<{ template: BoletimTemplate | null }>> {
  return outcome(apiFetch<{ template: BoletimTemplate | null }>(`/settings/document-templates/${kind}`));
}

/**
 * The placements, saved as a set. They travel as one JSON field because the
 * editor holds them as a list, not as form boxes; the API judges every one,
 * and refuses a field this kind of form does not offer.
 */
export async function saveBoletimFieldsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const kind = formData.get('kind');
  if (!isTemplateKind(kind)) return { ok: false, errorKey: 'boletimTemplate.saveFailed' };
  let fields: unknown;
  try {
    fields = JSON.parse(String(formData.get('fields') ?? '[]'));
  } catch {
    return { ok: false, errorKey: 'boletimTemplate.saveFailed' };
  }
  try {
    await apiPut(`/settings/document-templates/${kind}/fields`, { fields });
  } catch (error) {
    return describeFailure(error, 'boletimTemplate.saveFailed');
  }
  // Every site's *Documentos* tab shows the club's one form of each kind.
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
 * The model proposes where each field goes on one of the club's forms —
 * POOLSE-142 slice B. Nothing is saved: the editor loads the proposal for a
 * person to adjust and save. The form is read back from storage through the
 * API, which checks the reader may open it.
 */
export async function proposeBoletimFieldsAction(_previous: ProposalState, kind: TemplateKind): Promise<ProposalState> {
  if (!isTemplateKind(kind)) return { ok: false, note: 'unreadable' };
  const blocked = await readAiReaderGate('boletim_template');
  if (blocked !== null) return { ok: false, note: blocked };
  const refused = await guardAiCall(AI_ROLES.boletimTemplate);
  if (refused !== null) return { ok: false, note: refused === 'notAllowed' ? 'notAllowed' : 'rateLimited' };

  const loaded = await readBoletimTemplate(kind);
  if (loaded.state !== 'ok' || loaded.data.template === null) return { ok: false, note: 'unreadable' };
  const file = await apiFileResponse(`/files/${loaded.data.template.fileId}`);
  if (!file.ok) return { ok: false, note: 'unreadable' };
  const mediaType = (file.headers.get('content-type') ?? '').split(';')[0]!.trim();
  const read = await readBoletimLayout(Buffer.from(await file.arrayBuffer()), mediaType, kind);
  if ('error' in read) return { ok: false, note: read.error };
  return { ok: true, proposal: read.placements };
}

/** Takes the form away: the print goes back to Poolse's own. */
export async function removeBoletimTemplateAction(_previous: FormState, kind: TemplateKind): Promise<FormState> {
  if (!isTemplateKind(kind)) return { ok: false, errorKey: 'boletimTemplate.saveFailed' };
  try {
    await apiDelete(`/settings/document-templates/${kind}`);
  } catch (error) {
    return describeFailure(error, 'boletimTemplate.saveFailed');
  }
  revalidatePath('/dashboard/facilities', 'layout');
  return { ok: true, toastKey: kind === 'socio_form' ? 'boletimTemplate.removed' : 'boletimTemplate.removedFpn' };
}
