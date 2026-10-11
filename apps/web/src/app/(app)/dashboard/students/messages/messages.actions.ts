'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiDelete, apiPost, type MessagePreview } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * Messages to families — POOLSE-67.
 *
 * Preview and send are the same API call with `commit` set or not, so what the
 * dialog counted and what gets written cannot come from two code paths. Both
 * read the same form: the composer's Enviar button submits it a second time with
 * a different action rather than carrying the fields in client state.
 */

export interface PreviewState extends FormState {
  preview?: MessagePreview;
}

export interface SendState extends FormState {
  id?: string;
}

function target(formData: FormData): { audience: string; targetId?: string } {
  const audience = String(formData.get('audience') ?? '');
  const targetId = String(formData.get('targetId') ?? '');
  return audience === 'organization' || targetId === ''
    ? { audience }
    : { audience, targetId };
}

export async function previewMessageAction(
  organizationId: string,
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  try {
    const preview = await apiPost<MessagePreview>('/messages', target(formData), {
      organizationId,
    });
    return { ok: true, preview };
  } catch (error) {
    return describeFailure(error, 'messages.error.previewFailed');
  }
}

export async function sendMessageAction(
  organizationId: string,
  _previous: SendState,
  formData: FormData,
): Promise<SendState> {
  try {
    const sent = await apiPost<MessagePreview>(
      '/messages',
      {
        ...target(formData),
        subject: String(formData.get('subject') ?? ''),
        body: String(formData.get('body') ?? ''),
        commit: true,
      },
      { organizationId },
    );
    revalidatePath('/dashboard/students/messages');
    return sent.id === undefined ? { ok: true } : { ok: true, id: sent.id };
  } catch (error) {
    // The daily ceiling, with the database's own figures.
    if (error instanceof ApiError && error.code === 'message_quota') {
      const quota = (error.details as { messageQuota?: Record<string, unknown> } | null)
        ?.messageQuota;
      const limit = Number(quota?.['limit']);
      const used = Number(quota?.['used']);
      const requested = Number(quota?.['requested']);
      return {
        ok: false,
        errorKey:
          quota?.['kind'] === 'addresses'
            ? 'messages.error.quotaAddresses'
            : 'messages.error.quotaMessages',
        values: { limit, used, requested, left: Math.max(limit - used, 0) },
      };
    }
    if (error instanceof ApiError && error.code === 'no_recipients') {
      return { ok: false, errorKey: 'messages.error.noRecipients' };
    }
    return describeFailure(error, 'messages.error.sendFailed');
  }
}

export async function archiveMessageAction(
  organizationId: string,
  messageId: string,
): Promise<FormState> {
  try {
    await apiDelete(`/messages/${messageId}`, { organizationId });
  } catch (error) {
    return describeFailure(error, 'messages.error.archiveFailed');
  }
  revalidatePath('/dashboard/students/messages');
  return { ok: true };
}
