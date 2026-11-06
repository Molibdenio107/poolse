'use server';

import { ApiError, apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

const ID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface StudentMessageState extends FormState {
  /** One link per person, opened by a tap once the record exists. */
  links?: { name: string; url: string }[];
}

/**
 * A message to one student — POOLSE-191. The channel is the button pressed. The
 * API records first; for WhatsApp it answers the links, which only ever point at
 * wa.me, built there from the record's phone.
 */
export async function sendStudentMessageAction(
  _previous: StudentMessageState,
  formData: FormData,
): Promise<StudentMessageState> {
  const studentId = String(formData.get('studentId') ?? '');
  const channel = String(formData.get('channel') ?? '');
  if (!ID.test(studentId) || (channel !== 'email' && channel !== 'whatsapp')) {
    return { ok: false, errorKey: 'studentMessages.error.failed' };
  }
  const until = String(formData.get('shownUntil') ?? '');
  const showInApp = formData.get('showInApp') === 'on';
  if (showInApp && !DAY.test(until)) return { ok: false, errorKey: 'avisos.error.untilRequired' };
  try {
    const sent = await apiPost<{ links?: { name: string; url: string }[] }>(`/students/${studentId}/messages`, {
      channel,
      subject: String(formData.get('subject') ?? ''),
      body: String(formData.get('body') ?? ''),
      ...(showInApp ? { shownUntil: until } : {}),
    });
    // No revalidatePath: `useSavedAction` refreshes after the toast.
    return channel === 'whatsapp'
      ? { ok: true, toastKey: 'studentMessages.recorded', links: sent.links ?? [] }
      : { ok: true, toastKey: 'studentMessages.sent' };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'no_phone') {
      return { ok: false, errorKey: 'studentMessages.error.noPhone' };
    }
    if (error instanceof ApiError && error.code === 'no_recipients') {
      return { ok: false, errorKey: 'studentMessages.error.noEmail' };
    }
    if (error instanceof ApiError && error.code === 'message_quota') {
      const quota = (error.details as { messageQuota?: Record<string, unknown> } | null)?.messageQuota;
      const limit = Number(quota?.['limit']);
      const used = Number(quota?.['used']);
      const requested = Number(quota?.['requested']);
      return {
        ok: false,
        errorKey: 'messages.error.quotaAddresses',
        values: { limit, used, requested, left: Math.max(limit - used, 0) },
      };
    }
    return describeFailure(error, 'studentMessages.error.failed');
  }
}
