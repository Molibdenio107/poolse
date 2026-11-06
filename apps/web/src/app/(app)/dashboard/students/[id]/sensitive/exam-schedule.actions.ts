'use server';

import { ApiError, apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../../actions';

/**
 * Scheduling a medical exam — POOLSE-192. Owner and admin; the API refuses
 * anybody else, and these only carry its answer back.
 */

const ID = /^[0-9a-f-]{36}$/i;

export interface ReminderState extends FormState {
  links?: { name: string; url: string }[];
}

export async function createScheduleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  if (!ID.test(studentId)) return { ok: false, errorKey: 'examSchedule.error.failed' };
  try {
    await apiPost(`/students/${studentId}/medical-exam-schedule`, {
      kind: String(formData.get('kind') ?? ''),
      dueOn: String(formData.get('dueOn') ?? ''),
      dueTime: String(formData.get('dueTime') ?? ''),
      place: String(formData.get('place') ?? ''),
      note: String(formData.get('note') ?? ''),
    });
    return { ok: true, toastKey: 'examSchedule.saved' };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'schedule_open') {
      return { ok: false, errorKey: 'examSchedule.error.open' };
    }
    return describeFailure(error, 'examSchedule.error.failed');
  }
}

export async function cancelScheduleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const scheduleId = String(formData.get('scheduleId') ?? '');
  if (!ID.test(studentId) || !ID.test(scheduleId)) return { ok: false, errorKey: 'examSchedule.error.failed' };
  try {
    await apiPost(`/students/${studentId}/medical-exam-schedule/${scheduleId}/cancel`, {});
    return { ok: true, toastKey: 'examSchedule.cancelled' };
  } catch (error) {
    return describeFailure(error, 'examSchedule.error.failed');
  }
}

export async function remindAction(_previous: ReminderState, formData: FormData): Promise<ReminderState> {
  const studentId = String(formData.get('studentId') ?? '');
  const scheduleId = String(formData.get('scheduleId') ?? '');
  const channel = String(formData.get('channel') ?? '');
  if (!ID.test(studentId) || !ID.test(scheduleId) || (channel !== 'email' && channel !== 'whatsapp')) {
    return { ok: false, errorKey: 'examSchedule.error.failed' };
  }
  try {
    const sent = await apiPost<{ links?: { name: string; url: string }[] }>(
      `/students/${studentId}/medical-exam-schedule/${scheduleId}/remind`,
      {
        channel,
        subject: String(formData.get('subject') ?? ''),
        body: String(formData.get('body') ?? ''),
      },
    );
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
    return describeFailure(error, 'examSchedule.error.failed');
  }
}
