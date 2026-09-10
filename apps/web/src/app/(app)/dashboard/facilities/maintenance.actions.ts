'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiFetch,
  apiPatch,
  apiPost,
  type Paginated,
  type TaskCompletion,
  type TaskDetail,
  type TaskList,
} from '@/lib/api';
import type { FormState } from '../actions';

/**
 * Planned maintenance — slice 4.3.
 *
 * The same shape the panels around it use: a read returns null when the endpoint
 * refuses, so a block that cannot load is absent rather than rendered empty, and
 * never costs the whole page.
 *
 * **Nothing here decides a permission.** Every action posts and lets the API
 * answer; `canPlan` and `canComplete` travel with the read purely so the screen
 * can avoid showing a control that would be refused. Hiding a control is never
 * the control.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    // Field-named refusals land beside their field — an interval of zero, a
    // missing title, a target at another site. A message at the top of a form
    // cannot say which of six boxes it meant.
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

/*
 * Every screen a task appears on.
 *
 * The site's page holds the list, the task's own page holds the history, and the
 * dashboard holds "what is mine" — a completion recorded on any one of them
 * changes what the other two say. Revalidating one and not the others is how a
 * screen ends up showing a job as overdue ten minutes after somebody did it.
 */
function refresh(facilityId: string, taskId?: string): void {
  revalidatePath('/dashboard');
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  if (taskId !== undefined) revalidatePath(`/dashboard/facilities/tasks/${taskId}`);
}

export async function listTasks(facilityId: string): Promise<TaskList | null> {
  return apiFetch<TaskList>(`/maintenance/facilities/${facilityId}/tasks`).catch(() => null);
}

export async function listMyTasks(): Promise<TaskList | null> {
  // A student or an encarregado has no task list and the endpoint says so with a
  // 403. That is not an error worth a banner on the dashboard — the panel simply
  // is not there.
  return apiFetch<TaskList>('/maintenance/tasks/mine').catch(() => null);
}

export async function getTask(taskId: string): Promise<TaskDetail | null> {
  return apiFetch<TaskDetail>(`/maintenance/tasks/${taskId}`).catch(() => null);
}

export async function listCompletions(
  taskId: string,
  page: number,
): Promise<Paginated<TaskCompletion> | null> {
  return apiFetch<Paginated<TaskCompletion>>(
    `/maintenance/tasks/${taskId}/completions?page=${page}`,
  ).catch(() => null);
}

/**
 * What the form posts, read once.
 *
 * `intervalDays` is a text field rather than `type="number"` for the reason
 * every numeric field here is — a number input refuses silently and the form
 * then does nothing with no explanation (POOLSE-QA-07). The API validates it and
 * names the field.
 *
 * The three targets arrive as one `target` value of the form `space:<id>`, so
 * the control is a single picker and the "one thing only" rule the API enforces
 * cannot be broken by a screen that offers three dropdowns.
 */
function taskBody(formData: FormData): Record<string, unknown> {
  const target = String(formData.get('target') ?? '');
  const [kind, id] = target.split(':');

  return {
    title: String(formData.get('title') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    intervalDays: Number(String(formData.get('intervalDays') ?? '').trim().replace(',', '.')),
    assignedTo: String(formData.get('assignedTo') ?? ''),
    spaceId: kind === 'space' ? id : '',
    poolId: kind === 'pool' ? id : '',
    inventoryItemId: kind === 'item' ? id : '',
    active: formData.get('active') !== 'false',
  };
}

export async function createTask(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');

  try {
    await apiPost(
      `/maintenance/facilities/${facilityId}/tasks`,
      taskBody(formData),
    );
  } catch (error) {
    return failure(error, 'maintenance.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

export async function updateTask(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');

  try {
    await apiPatch(`/maintenance/tasks/${taskId}`, taskBody(formData));
  } catch (error) {
    return failure(error, 'maintenance.saveFailed');
  }

  refresh(facilityId, taskId);
  return { ok: true };
}

export async function archiveTask(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');

  try {
    await apiPost(`/maintenance/tasks/${taskId}/archive`, {});
  } catch (error) {
    return failure(error, 'maintenance.saveFailed');
  }

  refresh(facilityId, taskId);
  return { ok: true };
}

/**
 * "Feito".
 *
 * `performedAt` is optional and empty means now, which is the one-tap case the
 * button exists for. The task page offers the date because a job done on
 * Saturday and typed in on Monday is ordinary, and the whole due calculation
 * runs from when the work happened.
 */
export async function completeTask(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');

  try {
    await apiPost(
      `/maintenance/tasks/${taskId}/completions`,
      {
        performedAt: String(formData.get('performedAt') ?? '').trim(),
        note: String(formData.get('note') ?? '').trim(),
      },
    );
  } catch (error) {
    return failure(error, 'maintenance.completeFailed');
  }

  refresh(facilityId, taskId);
  return { ok: true };
}

export async function removeCompletion(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const completionId = String(formData.get('completionId') ?? '');

  try {
    await apiPost(`/maintenance/completions/${completionId}/archive`, {});
  } catch (error) {
    return failure(error, 'maintenance.saveFailed');
  }

  refresh(facilityId, taskId);
  return { ok: true };
}
