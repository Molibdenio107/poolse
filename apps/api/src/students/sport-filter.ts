import { BadRequestException } from '@nestjs/common';
import { withOrg } from '@poolse/db';

/**
 * `?sport=` on a list — POOLSE-143, rule 10.
 *
 * A sport's *Alunos*, *Pedidos*, *Níveis* and *Avanços* are the shared lists
 * filtered by it. The value is one the club has switched on, or `none` for the
 * shared list's *Sem modalidade* chip (nothing live to place the row in a
 * sport). Anything else is a 400 rather than an empty list: a list that
 * silently answers nobody for a mistyped sport reads as a club with no students.
 *
 * **A convenience filter, never an authorisation boundary.** An instructor may
 * still ask for another sport's rows, exactly as before, until POOLSE-145
 * scopes instructors to their sports.
 */
export type SportFilter = string | 'none' | null;

export async function readSportFilter(organizationId: string, raw: string | undefined): Promise<SportFilter> {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (value === 'none') return 'none';
  const enabled = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ enabled_sports: string[] }>(
      'SELECT enabled_sports::text[] AS enabled_sports FROM organization WHERE id = $1',
      [organizationId],
    );
    return rows[0]?.enabled_sports ?? ['pool'];
  });
  if (!enabled.includes(value)) {
    throw new BadRequestException({
      code: 'sport_not_enabled',
      message: `This club has no ${value}`,
    });
  }
  return value;
}
