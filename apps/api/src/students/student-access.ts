import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole } from '../tenant/roles.js';
import { sportScope } from '../tenant/sport-scope.js';
import { mayActForStudent } from './redemption.repository.js';
import { studentInSports } from './students.repository.js';

/**
 * A student's own pages — their record, timetable, calendar and swim records.
 *
 * Staff (owner, admin, instructor) pass. Anybody else — a student, an
 * encarregado — passes only for themselves or a child they are linked to, the
 * rule `mayActForStudent` already holds for reposição credits (QA 21.8).
 *
 * A 404 rather than a 403 for somebody else's child, so a stranger cannot learn
 * which student ids exist by the shape of the refusal. Security review of
 * 12 October 2026: these routes answered any member about any child.
 */
export async function requireActsForStudent(studentId: string): Promise<void> {
  const { organizationId, membershipId } = currentTenant();
  if (hasRole('owner', 'admin', 'instructor')) {
    /*
     * POOLSE-145: an instructor scoped to some sports reads only students with
     * an active turma in one of them — or their own child, as any family does.
     * A 403 naming the reason: they may well have seen the name on a register.
     */
    const scope = sportScope();
    if (scope === null || (await studentInSports(organizationId, studentId, scope))) return;
    if (await mayActForStudent(organizationId, membershipId, studentId)) return;
    throw new ForbiddenException({ code: 'sport_not_yours', message: 'This student is in none of your sports' });
  }
  if (!(await mayActForStudent(organizationId, membershipId, studentId))) {
    throw new NotFoundException('No such student');
  }
}
