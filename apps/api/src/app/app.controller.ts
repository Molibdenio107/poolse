import { payToFor, type PayTo } from '../billing/payment-destinations.js';
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { familyStudents } from '../students/students.repository.js';
import { studentFees } from '../billing/fees.repository.js';
import type { FeeBalance } from '../billing/fee-balance.js';
import { readAgenda, readWater, type AgendaEntry, type WaterReading } from './agenda.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Child {
  id: string;
  name: string;
  relationship: string | null;
  /** The reader is this student — the adult path, or a student's own login. */
  self: boolean;
  /** What is owed, from the fee read's `balance`; null when nothing is agreed. */
  fees: (FeeBalance & { lines: number }) | null;
  /** Where to pay, when something is owed and the club says where — POOLSE-94. */
  payTo: PayTo | null;
}

interface AgendaResponse {
  children: Child[];
  entries: AgendaEntry[];
  /** Latest temperature per tank in the entries; empty with water quality off. */
  water: WaterReading[];
}

/**
 * App mode's family reads — POOLSE-90 slice 1.
 *
 * Guardians and students only, and only ever about the reader's own records:
 * the children come from `familyStudents`, and a `child` that is not one of
 * them is a 404, the answer `requireActsForStudent` gives a stranger. Staff who
 * are also parents reach this through their guardian role like anybody else.
 */
@CoreRoute()
@Controller('app')
export class AppController {
  @Get('agenda')
  async agenda(@Query('child') child?: string): Promise<AgendaResponse> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();

    const mine = await familyStudents(organizationId, membershipId);
    if (child !== undefined && !mine.some((one) => one.id === child)) {
      throw new NotFoundException('No such student');
    }
    const chosen = child === undefined ? mine : mine.filter((one) => one.id === child);

    const entries = await readAgenda(
      organizationId,
      chosen.map((one) => one.id),
    );
    return {
      children: await withFees(organizationId, mine),
      entries,
      water: await waterFor(organizationId, entries),
    };
  }

  /**
   * One lesson, for the lesson's page: the entries for this session among the
   * reader's children. Not theirs, not coming, or not a turma lesson: 404.
   */
  @Get('lessons/:sessionId')
  async lesson(@Param('sessionId') sessionId: string): Promise<Omit<AgendaResponse, 'children'>> {
    requireRole('guardian', 'student');
    if (!UUID.test(sessionId)) throw new NotFoundException('No such lesson');
    const { organizationId, membershipId } = currentTenant();

    const mine = await familyStudents(organizationId, membershipId);
    const entries = await readAgenda(
      organizationId,
      mine.map((one) => one.id),
      sessionId,
    );
    if (entries.length === 0) throw new NotFoundException('No such lesson');
    return { entries, water: await waterFor(organizationId, entries) };
  }
}

/** The water at the tanks these lessons are in — never when the module is off. */
async function waterFor(organizationId: string, entries: AgendaEntry[]): Promise<WaterReading[]> {
  if (!moduleIsOn('water_quality')) return [];
  const pools = [...new Set(entries.map((entry) => entry.poolId).filter((id): id is string => id !== null))];
  return readWater(organizationId, pools);
}

/** Each child's fee status — `balance`, the one definition, never re-added here. */
async function withFees(
  organizationId: string,
  children: { id: string; name: string; relationship: string | null; self: boolean }[],
): Promise<Child[]> {
  return Promise.all(
    children.map(async (child) => {
      const fees = await studentFees(organizationId, child.id);
      const lines = fees.lines.filter((line) => line.endsOn === null).length;
      const owing = fees.balance.outstandingCents > 0;
      return {
        ...child,
        fees: lines === 0 ? null : { ...fees.balance, lines },
        payTo: owing ? await payToFor(organizationId, child.id) : null,
      };
    }),
  );
}
