import { coverRequestOf } from './lesson-requests.repository.js';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ConflictException,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { cancelState, isOwnClass, mayCancel } from './sessions.repository.js';
import { isMySession, requireMySession } from '../tenant/assignment.js';
import {
  findRegister,
  saveRegister,
  summaryForStudent,
  type AttendanceStatus,
  type AttendanceSummary,
  type Mark,
  type Register,
  RegisterRefusedError,
} from './attendance.repository.js';
import { CoreRoute } from '../tenant/modules.js';
import { lessonContact, type LessonContact } from '../students/students.repository.js';
import { sessionFeedback, type LessonFeedback } from '../feedback/feedback.repository.js';
import { sessionNotices, type SessionNotice } from '../notices/notices.repository.js';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'excused'];
const MAX_NOTE = 200;

/** A class of 500 is not a class. Anything larger is a mistake or an attack. */
const MAX_MARKS = 200;

interface RegisterResponse extends Register {
  organizationId: string;
  canRecord: boolean;
  /** POOLSE-198: this teacher may ask for cover, and what is already asked. */
  canRequestCover: boolean;
  coverRequest: { note: string | null; requestedBy: string } | null;
  /**
   * Cancelar aula, asked the way `POST /sessions/:id/cancel` asks it — owner,
   * admin, or the instructor teaching it (POOLSE-88 slice 2: the session page is
   * the lesson's page on a phone). Only management may end every later week
   * or put a cancelled lesson back, so `canEndSeries` answers both.
   */
  canCancel: boolean;
  canEndSeries: boolean;
  /**
   * What the students said about this lesson — POOLSE-116. Every one for
   * owner and admin; for an instructor, only on a lesson they taught (the
   * stand-in's night is the stand-in's), else empty.
   */
  feedback: LessonFeedback[];
  /**
   * *Vou / Não vou* — POOLSE-90 slice 2: what the families said before the
   * lesson, beside each child on the register. A notice, never a mark.
   */
  notices: SessionNotice[];
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
@CoreRoute()
@Controller('sessions')
export class AttendanceController {
  @Get(':id/attendance')
  async register(@Param('id') id: string): Promise<RegisterResponse> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId, membershipId } = currentTenant();

    const register = await findRegister(organizationId, id);
    if (!register) throw new NotFoundException('No such class');

    /*
     * Readable by any of the three roles, writable only by the person teaching
     * it — 1.12. An instructor looking at a colleague's register to see how a
     * child is getting on is ordinary; editing it is not, so `canRecord` says
     * which of the two this is and the POST enforces it regardless.
     */
    const management = hasRole('owner', 'admin');
    const mine = await isMySession(id);
    const state = await cancelState(organizationId, id);
    const own = await isOwnClass(organizationId, id, membershipId);
    const familyNotes = management || mine;
    const viewing = currentTenant().viewing != null;
    const cover = familyNotes ? await coverRequestOf(organizationId, id) : null;
    return {
      ...register,
      /*
       * A colleague may still read a register, so they keep the names and marks.
       * A face and what the family said are for whoever teaches it (POOLSE-197).
       * Under a view the exam and insurance go too, because `expired` is also how
       * an unfit result reads, and so do the notes: POOLSE-188 rule 8.
       */
      entries: register.entries.map((entry) => ({
        ...entry,
        photoFileId: familyNotes ? entry.photoFileId : null,
        ...(viewing ? { examState: 'none' as const, insured: true, note: null } : {}),
      })),
      organizationId,
      canRecord: mine,
      // Until it ends, marks or not; after, the office and only unmarked (02-11-2026).
      canCancel:
        state !== null &&
        mayCancel(state, management, management || (await isOwnClass(organizationId, id, membershipId))),
      canEndSeries: management,
      // POOLSE-198: the lesson's teacher, before it ends and while it is on.
      canRequestCover:
        own && hasRole('instructor') && state !== null && !state.ended && register.status !== 'cancelled',
      coverRequest:
        cover === null ? null : viewing ? { note: null, requestedBy: cover.requestedBy } : cover,
      feedback: management || mine ? await sessionFeedback(organizationId, id, management ? null : membershipId) : [],
      notices: familyNotes ? await sessionNotices(organizationId, id) : [],
    };
  }

  /**
   * Who to call about a child on this lesson (Rui, 07-11-2026): whoever is teaching
   * it tonight, a stand-in included, and only for somebody on its roll. Not on the
   * view list, so a view of somebody's app never opens a family's numbers.
   */
  @Get(':id/contacts/:studentId')
  async contact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<LessonContact> {
    requireRole('instructor');
    const { organizationId, membershipId } = currentTenant();
    const register = await findRegister(organizationId, id);
    if (!register) throw new NotFoundException('No such class');
    if (!(await isOwnClass(organizationId, id, membershipId))) {
      throw new ForbiddenException({ code: 'not_your_class', message: 'Only the lesson’s teacher reads this' });
    }
    const contact = register.entries.some((entry) => entry.studentId === studentId)
      ? await lessonContact(organizationId, studentId)
      : null;
    if (contact === null) throw new NotFoundException('No such student on this lesson');
    return contact;
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

    try {
      if (!(await saveRegister(organizationId, id, membershipId, marks))) {
        throw new NotFoundException('No such class');
      }
    } catch (error) {
      if (error instanceof RegisterRefusedError) {
        throw new ConflictException({ code: `register_${error.reason}`, message: `attendance.refused.${error.reason}` });
      }
      // A credited mark arrives as RegisterRefusedError('credited') — see saveRegisterIn.
      throw error;
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
