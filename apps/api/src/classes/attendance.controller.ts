import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { isMySession, requireMySession } from '../tenant/assignment.js';
import {
  findRegister,
  saveRegister,
  summaryForStudent,
  type AttendanceStatus,
  type AttendanceSummary,
  type Mark,
  type Register,
} from './attendance.repository.js';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'excused'];
const MAX_NOTE = 200;

/** A class of 500 is not a class. Anything larger is a mistake or an attack. */
const MAX_MARKS = 200;

interface RegisterResponse extends Register {
  organizationId: string;
  canRecord: boolean;
}

/**
 * Attendance — slice 1.8.
 *
 * `instructor` is in the allowed set, and that is the point of the slice: the
 * person standing on the poolside is the one who knows who turned up. Owners and
 * admins can mark too, because a club where only the instructor can correct a
 * register is a club that cannot fix last Tuesday when the instructor has left.
 *
 * **Slice 1.12 narrows an instructor to their own classes**, and this is the
 * surface it matters most on: a register is a record of who was in the water,
 * and a colleague editing it is a colleague overwriting a fact they were not
 * present for. Owner and admin still reach every register, because a club where
 * the office cannot fix last Tuesday after the instructor has left is a club
 * that phones support.
 *
 * "Their own" is read from `resolved_instructor_id`, so **the substitute is the
 * assigned instructor of the night they cover** and the person they are covering
 * for is not. Marking the register is precisely what a substitute is there to
 * do — see `tenant/assignment.ts`.
 */
@Controller('sessions')
export class AttendanceController {
  @Get(':id/attendance')
  async register(@Param('id') id: string): Promise<RegisterResponse> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    const register = await findRegister(organizationId, id);
    if (!register) throw new NotFoundException('No such class');

    /*
     * Readable by any of the three roles, writable only by the person teaching
     * it — 1.12. An instructor looking at a colleague's register to see how a
     * child is getting on is ordinary; editing it is not, so `canRecord` says
     * which of the two this is and the POST enforces it regardless.
     */
    return { ...register, organizationId, canRecord: await isMySession(id) };
  }

  /**
   * Saves the whole register in one call.
   *
   * The acceptance criterion is "an instructor marks a class in under a minute",
   * and a per-student endpoint would fail it twice over — fifteen round trips on
   * poolside wifi, and a screen somebody abandons halfway leaving a class
   * half-marked with no way to tell the rest were absent.
   */
  @Post(':id/attendance')
  async record(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ recorded: true }> {
    requireRole('owner', 'admin', 'instructor');
    // The control, not the courtesy: the screen hides the save button for a
    // register that is not yours, and this is what refuses the request anyway.
    await requireMySession(id);
    const { organizationId, membershipId } = currentTenant();

    const marks = parseMarks(body['marks']);

    if (!(await saveRegister(organizationId, id, membershipId, marks))) {
      throw new NotFoundException('No such class');
    }
    return { recorded: true };
  }

  /**
   * One student's attendance over a window.
   *
   * On the session controller rather than the student one because it is a fact
   * about classes: the window is a range of sessions, and the numbers only mean
   * anything against the sessions that person was enrolled for.
   */
  @Get('attendance/student/:studentId')
  async forStudent(
    @Param('studentId') studentId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<AttendanceSummary> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    return summaryForStudent(organizationId, studentId, date(from, 'from'), date(to, 'to'));
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(value: string, field: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new BadRequestException(`${field} must be a date, YYYY-MM-DD`);
  }
  return value;
}

/**
 * The marks, validated as a set.
 *
 * A null status is kept rather than dropped: it means "unmark this student", and
 * the repository turns it into a delete. Silently discarding it would make
 * clearing a mistaken mark impossible.
 */
function parseMarks(value: unknown): Mark[] {
  if (!Array.isArray(value)) throw new BadRequestException('marks must be a list');
  if (value.length > MAX_MARKS) {
    throw new BadRequestException(`A register may hold at most ${MAX_MARKS} students`);
  }

  const seen = new Set<string>();

  return value.map((entry): Mark => {
    if (entry === null || typeof entry !== 'object') {
      throw new BadRequestException('Each mark must be an object');
    }
    const row = entry as Record<string, unknown>;

    const studentId = typeof row['studentId'] === 'string' ? row['studentId'].trim() : '';
    if (studentId === '') throw new BadRequestException('Each mark needs a studentId');

    // One statement writes the lot, and a duplicate id would make the outcome
    // depend on row order inside it — which is not something to leave to chance.
    if (seen.has(studentId)) {
      throw new BadRequestException(`${studentId} appears twice in one register`);
    }
    seen.add(studentId);

    const raw = row['status'];
    if (raw !== null && raw !== undefined && !STATUSES.includes(raw as AttendanceStatus)) {
      throw new BadRequestException(`Unknown status: expected one of ${STATUSES.join(', ')}`);
    }
    const status = raw === null || raw === undefined ? null : (raw as AttendanceStatus);

    const noteRaw = typeof row['note'] === 'string' ? row['note'].trim() : '';
    if (noteRaw.length > MAX_NOTE) {
      throw new BadRequestException(`A note may be at most ${MAX_NOTE} characters`);
    }

    // A note on an unmarked student has nothing to hang on — the row is about to
    // be deleted, and keeping the text would be storing a comment about an event
    // nobody recorded.
    return { studentId, status, note: status === null || noteRaw === '' ? null : noteRaw };
  });
}
