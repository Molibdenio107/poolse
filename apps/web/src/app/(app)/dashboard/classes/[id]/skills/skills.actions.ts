'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, type MarkOutcome, type SkillState } from '../../../../../../lib/api';

/**
 * Marks skills — POOLSE-20.
 *
 * Returns null on failure rather than throwing. The grid paints optimistically
 * and needs to know whether to roll back; a thrown error would take the whole
 * screen down mid-lesson, which is the one moment it must not.
 *
 * No `revalidatePath` on success: the grid already holds the truth it just sent,
 * and re-rendering the page under an instructor's fingers would scroll a wide
 * table back to the left.
 */
export async function markSkillsAction(
  classGroupId: string,
  marks: { studentId: string; skillId: string; state: SkillState; overrideReason: string | null }[],
): Promise<MarkOutcome | null> {
  try {
    return await apiPost<MarkOutcome>('/skills/mark', { marks });
  } catch {
    return null;
  }
}

/**
 * Nudges the pages that show progress, once the lesson is over.
 *
 * Separate from marking on purpose — see above.
 */
export async function refreshSkillsAction(classGroupId: string): Promise<void> {
  revalidatePath(`/dashboard/classes/${classGroupId}/skills`);
  revalidatePath(`/dashboard/classes/${classGroupId}`);
}
