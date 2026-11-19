'use server';

import { revalidatePath } from 'next/cache';
import { apiPut } from '@/lib/api';

/**
 * The tour's outcome, for the reader's own row — POOLSE-230. Best effort: a
 * tour that could not be recorded (offline, or under *Ver como*, which is read
 * only) has still been seen, and nothing on screen depends on it but the
 * checklist's tick.
 */
export async function recordTourAction(outcome: 'finished' | 'dismissed'): Promise<void> {
  try {
    await apiPut('/onboarding/tour', { outcome });
    revalidatePath('/dashboard/welcome');
  } catch {
    // Seen is seen; the next tour records it.
  }
}
