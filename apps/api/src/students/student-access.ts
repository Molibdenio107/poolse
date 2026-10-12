import { NotFoundException } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole } from '../tenant/roles.js';
import { mayActForStudent } from './redemption.repository.js';

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
  if (hasRole('owner', 'admin', 'instructor')) return;
  const { organizationId, membershipId } = currentTenant();
  if (!(await mayActForStudent(organizationId, membershipId, studentId))) {
    throw new NotFoundException('No such student');
  }
}
