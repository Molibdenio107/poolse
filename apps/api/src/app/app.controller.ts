import { payToFor, type PayTo } from '../billing/payment-destinations.js';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { familyStudents } from '../students/students.repository.js';
import { studentFees } from '../billing/fees.repository.js';
import type { FeeBalance } from '../billing/fee-balance.js';
import {
  readAgenda,
  readRecent,
  readWater,
  type AgendaEntry,
  type RecentLesson,
  type WaterReading,
} from './agenda.repository.js';
import {
  familyFeedback,
  FeedbackRefusedError,
  saveFeedback,
  type FamilyFeedback,
  type LessonFeedback,
} from '../feedback/feedback.repository.js';
import { listMedicalLeave, type CertificateFile } from '../students/medical-leave.repository.js';
import { clubToday } from '../common/club-day.js';
import { readMyWeek, type WeekClass } from '../dashboard/instructor.repository.js';

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
  /** *Últimas aulas* — attended lessons inside the feedback window (POOLSE-116). */
  recent: RecentLesson[];
}

/** A comment's ceiling — the table's CHECK says the same. */
const MAX_COMMENT = 500;

/** A leave as a family reads it: the dates and the atestado, never the club's reason or reference. */
interface FamilyLeave {
  id: string;
  studentId: string;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  certificate: CertificateFile | null;
}

/** How long after it ends a leave still shows, so a late atestado can be sent. */
const LEAVE_SHOWN_DAYS = 90;

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
      membershipId,
      chosen.map((one) => one.id),
    );
    return {
      children: await withFees(organizationId, mine),
      entries,
      water: await waterFor(organizationId, entries),
      recent: await readRecent(
        organizationId,
        membershipId,
        chosen.map((one) => one.id),
      ),
    };
  }

  /**
   * The children's medical leaves, for sending the atestado — POOLSE-109.
   * Leaves the club recorded, current or ended in the last 90 days; the family
   * sees the dates and its own atestado, never the reason the office typed.
   */
  @Get('medical-leave')
  async medicalLeave(): Promise<{ leaves: FamilyLeave[] }> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    const mine = await familyStudents(organizationId, membershipId);
    const since = shiftDays(clubToday(), -LEAVE_SHOWN_DAYS);
    const leaves: FamilyLeave[] = [];
    for (const child of mine) {
      for (const leave of await listMedicalLeave(organizationId, child.id, true)) {
        if (leave.endsOn !== null && leave.endsOn < since) continue;
        leaves.push({
          id: leave.id,
          studentId: child.id,
          startsOn: leave.startsOn,
          endsOn: leave.endsOn,
          active: leave.active,
          certificate: leave.certificate?.file ?? null,
        });
      }
    }
    return { leaves };
  }

  /**
   * One lesson, for the lesson's page: the entries for this session among the
   * reader's children. Not theirs, not coming, or not a turma lesson: 404.
   */
  @Get('lessons/:sessionId')
  async lesson(
    @Param('sessionId') sessionId: string,
  ): Promise<Omit<AgendaResponse, 'children' | 'recent'> & { feedback: FamilyFeedback[] }> {
    requireRole('guardian', 'student');
    if (!UUID.test(sessionId)) throw new NotFoundException('No such lesson');
    const { organizationId, membershipId } = currentTenant();

    const mine = await familyStudents(organizationId, membershipId);
    const entries = await readAgenda(
      organizationId,
      membershipId,
      mine.map((one) => one.id),
      sessionId,
    );
    if (entries.length === 0) throw new NotFoundException('No such lesson');
    return {
      entries,
      water: await waterFor(organizationId, entries),
      feedback: await familyFeedback(
        organizationId,
        membershipId,
        sessionId,
        [...new Set(entries.map((entry) => entry.studentId))],
      ),
    };
  }

  /**
   * The instructor's home — POOLSE-90 slice 2: this week's lessons where they
   * are `resolved_instructor_id`, so a stand-in sees the night they cover and the
   * regular instructor does not. The dashboard band's own query, one definition,
   * with the enrolled count and the *Não vou* count beside each.
   */
  @Get('teaching')
  async teaching(): Promise<{ lessons: WeekClass[] }> {
    requireRole('instructor');
    const { organizationId, membershipId } = currentTenant();
    return { lessons: await readMyWeek(organizationId, membershipId) };
  }

  /**
   * How the lesson went — POOLSE-116. One child's mood and a few words, written
   * or rewritten inside the window. The child must be the reader's and in this
   * lesson (else 404, as a stranger's lesson is), the reader must be the one who
   * answers for them (else 403), and the database decides whether the lesson
   * takes feedback at all (else 409 with its code).
   */
  @Put('lessons/:sessionId/feedback')
  async feedback(
    @Param('sessionId') sessionId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<LessonFeedback> {
    requireRole('guardian', 'student');
    if (!UUID.test(sessionId)) throw new NotFoundException('No such lesson');
    const { organizationId, membershipId } = currentTenant();
    const input = parseFeedback(body);

    const mine = await familyStudents(organizationId, membershipId);
    if (!mine.some((one) => one.id === input.studentId)) throw new NotFoundException('No such lesson');
    const [standing] = await familyFeedback(organizationId, membershipId, sessionId, [input.studentId]);
    if (standing === undefined) throw new NotFoundException('No such lesson');
    if (!standing.mayAnswer) {
      throw new ForbiddenException({ code: 'feedback_guardian_answers', message: 'app.feedback.guardianAnswers' });
    }

    try {
      return await saveFeedback(organizationId, membershipId, sessionId, input.studentId, {
        mood: input.mood,
        comment: input.comment,
      });
    } catch (error) {
      if (error instanceof FeedbackRefusedError) {
        throw new ConflictException({
          code: error.code,
          message: `app.feedback.refused.${error.code}`,
          ...(error.code === 'feedback_window_closed' ? { closesOn: error.value } : {}),
        });
      }
      throw error;
    }
  }
}

function parseFeedback(body: Record<string, unknown>): { studentId: string; mood: number; comment: string | null } {
  const studentId = body['studentId'];
  if (typeof studentId !== 'string' || !UUID.test(studentId)) {
    throw new BadRequestException({ message: 'studentId is required', fields: { studentId: 'app.feedback.error.student' } });
  }
  const mood = body['mood'];
  if (typeof mood !== 'number' || !Number.isInteger(mood) || mood < 1 || mood > 5) {
    throw new BadRequestException({ message: 'mood is 1 to 5', fields: { mood: 'app.feedback.error.mood' } });
  }
  const raw = body['comment'];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw new BadRequestException({ message: 'comment is text', fields: { comment: 'app.feedback.error.comment' } });
  }
  const comment = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  if (comment !== null && [...comment].length > MAX_COMMENT) {
    throw new BadRequestException({
      message: `comment is at most ${MAX_COMMENT} characters`,
      fields: { comment: 'app.feedback.error.tooLong' },
    });
  }
  return { studentId, mood, comment };
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

/** A calendar day moved by whole days, as text — never through a timezone. */
function shiftDays(day: string, days: number): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
