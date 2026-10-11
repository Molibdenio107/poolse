import { ConflictException } from '@nestjs/common';

/**
 * An expired qualification refused an assignment — POOLSE-27.
 *
 * `qualification_assignment_allowed` raises with
 * `qualification_blocked|<type name>|<expired on>` in DETAIL, and only for a
 * type the club switched to blocking. The figures come off the error rather than
 * a second query, the shape `poolCapacityRefusal` uses: the sentence names the
 * certificate and the day it lapsed, so the office knows what to renew.
 *
 * Shared by the turma and booking controllers, because the trigger guards both.
 */
export function qualificationRefusal(error: unknown): ConflictException | null {
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== 'string' || !detail.startsWith('qualification_blocked|')) return null;

  const [, type, expiredOn] = detail.split('|');
  return new ConflictException({
    code: 'qualification_blocked',
    message: `The instructor's ${type} expired on ${expiredOn}`,
    fields: { instructorMembershipId: 'qualifications.blockedAssignment' },
    qualificationBlocked: { type: type ?? '', expiredOn: expiredOn ?? '' },
  });
}
