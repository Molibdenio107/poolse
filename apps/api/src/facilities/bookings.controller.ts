import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  ClosedError,
  DuplicateBookingError,
  duplicateBooking,
  LaneTakenError,
  moveBooking,
  NonContiguousLanesError,
  assignInstructor,
  runTimetableImport,
  setInstructorStatus,
  type BookingTarget,
  type SettableStatus,
  type TimetableImportResult,
} from './bookings.repository.js';
import { MAX_TIMETABLE_ROWS, type RawTimetableRow } from './timetable-import.js';

/**
 * What a drag on the lane grid writes — POOLSE-50.
 *
 * Two routes, because there are two outcomes: the block is somewhere else, or
 * there is now another one of it. Moving, spanning lanes and the keyboard
 * equivalents of both are all the same write — the client sends where the block
 * ended up — which is the point of having one reducer rather than an endpoint
 * per gesture.
 *
 * **Owner/admin, enforced here.** The grid hides the grips for everyone else,
 * and that is a courtesy; this is the control. An instructor who reconstructs
 * the request by hand gets a 403 — QA 50.15.
 *
 * **Every refusal is a named reason, never a constraint.** A drop that collides
 * has to come back as "Cadetes already runs then" or "Pista 3 is taken by
 * Infantis", because the operator is mid-gesture and a Postgres constraint name
 * tells them nothing they can act on.
 */
@Controller('bookings')
export class BookingsController {
  @Post(':scheduleId/move')
  async move(
    @Param('scheduleId') scheduleId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ moved: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let moved: boolean;
    try {
      moved = await moveBooking(organizationId, scheduleId, readTarget(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (!moved) throw new NotFoundException('No such booking');
    return { moved: true };
  }

  @Post(':scheduleId/duplicate')
  async duplicate(
    @Param('scheduleId') scheduleId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let copy: { id: string } | null;
    try {
      copy = await duplicateBooking(organizationId, scheduleId, readTarget(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (copy === null) throw new NotFoundException('No such booking');
    return copy;
  }

  /**
   * A timetable arriving as a file — POOLSE-57.
   *
   * Preview and commit are one route with a flag, as every other importer's is:
   * two routes would be two places rows become records, and applying them
   * differently is how an approved preview becomes a different set of writes.
   * The commit re-runs the same preview and refuses on its own `committable`,
   * so a file that became conflicted while somebody was reading it is refused
   * rather than half-applied.
   *
   * **Owner and admin.** Creating one booking is owner/admin on the grid, so
   * creating seventy from a file is owner/admin too.
   */
  @Post('timetable-import/:facilityId')
  async importTimetable(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<TimetableImportResult> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const result = await runTimetableImport(organizationId, {
      facilityId,
      rows: readTimetableRows(body['rows']),
      commit: body['commit'] === true,
      drop: readIndexes(body['drop']),
    });

    // One 404 for "no such site" and "no published season": neither is a thing
    // this caller can act on differently, and a draft season has no timetable
    // for a file to join.
    if (result === null) throw new NotFoundException('No such site, or no published season');
    return result;
  }

  /**
   * Put somebody on this class — the other half of POOLSE-53's alert.
   *
   * The counter named the gap and clicking it filtered the grid to it; there was
   * then nothing to *do*. This is the doing, on the block where the gap is
   * visible, rather than a trip to the Turmas screen — and for a parceria there
   * was no trip to take, because it has no turma to edit.
   *
   * The body's `membershipId` may be null, which clears the override and hands
   * the booking back to its turma's own instructor. The status is not accepted
   * and not returned from the request: POOLSE-53 made it the database's, and it
   * follows from this write.
   */
  @Post(':scheduleId/instructor')
  async assign(
    @Param('scheduleId') scheduleId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ status: string; instructorName: string | null }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const raw = body['membershipId'];
    const membershipId =
      raw === null || raw === undefined || raw === '' ? null : String(raw).trim();

    const result = await assignInstructor(organizationId, scheduleId, membershipId);
    // One 404 for both "no such booking" and "not an instructor here": neither
    // is a thing this caller should be told apart, and the picker only ever
    // offers people who are.
    if (result === null) throw new NotFoundException('No such booking or instructor');
    return result;
  }

  /**
   * "This one has nobody" — and the way back — POOLSE-53.
   *
   * The one transition a person makes by hand. Everything else about
   * `instructor_status` is the database's, which is why the body accepts exactly
   * two values and the response says what the row ended up as rather than
   * echoing what was asked for.
   *
   * Owner/admin, enforced here. Reading the counter is open to any member — an
   * instructor should see that Thursday at seven has nobody — but declaring it
   * is a management act, and QA 50.15's reconstructed-request test applies to
   * this route for the same reason it applies to the other two.
   */
  @Post(':scheduleId/instructor-status')
  async instructorStatus(
    @Param('scheduleId') scheduleId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ status: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const result = await setInstructorStatus(organizationId, scheduleId, readStatus(body));
    if (result === null) throw new NotFoundException('No such booking');
    return result;
  }
}

/**
 * The two states a person may set.
 *
 * `assigned` and `external` are refused rather than silently corrected. They are
 * facts about who is teaching, maintained by the trigger from the instructor
 * columns, and a request that claims one is a request that has misunderstood
 * what it is looking at — better a 400 than a save that reads back differently.
 */
function readStatus(body: Record<string, unknown>): SettableStatus {
  const raw = body['status'];
  if (raw !== 'to_define' && raw !== 'uncovered') {
    throw new BadRequestException('status must be to_define or uncovered');
  }
  return raw;
}

/**
 * The candidate bookings, off the wire.
 *
 * Names rather than ids throughout — the file says `Pista 2` and `Sandra`, and
 * resolving those against *this* facility is the preview's job, not the
 * client's. A client that sent ids would be asserting something it cannot know.
 */
function readTimetableRows(raw: unknown): RawTimetableRow[] {
  if (!Array.isArray(raw)) throw new BadRequestException('rows must be a list');
  if (raw.length === 0) throw new BadRequestException('rows is empty');
  if (raw.length > MAX_TIMETABLE_ROWS) {
    throw new BadRequestException(`at most ${MAX_TIMETABLE_ROWS} bookings in one import`);
  }

  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException('each row must be an object');
    }
    const row = entry as Record<string, unknown>;

    const weekday = Number(row['weekday']);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new BadRequestException(`row ${index + 1}: weekday must be 1..7`);
    }

    const lanes = Array.isArray(row['laneNames'])
      ? row['laneNames'].map((lane) => String(lane))
      : [];
    if (lanes.length > 24) throw new BadRequestException(`row ${index + 1}: too many lanes`);

    const headcount = row['headcount'];

    return {
      weekday,
      startTime: String(row['startTime'] ?? ''),
      durationMinutes: Number(row['durationMinutes'] ?? 0),
      name: String(row['name'] ?? ''),
      laneNames: lanes,
      instructorName: row['instructorName'] === undefined ? null : String(row['instructorName']),
      headcount:
        headcount === null || headcount === undefined || headcount === ''
          ? null
          : Number(headcount),
      line: Number.isInteger(Number(row['line'])) ? Number(row['line']) : index + 1,
    } satisfies RawTimetableRow;
  });
}

/** Row indexes the operator settled in the conflict dialog. */
function readIndexes(raw: unknown): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestException('drop must be a list of row indexes');

  return raw.map((value) => {
    const index = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(index) || index < 0) {
      throw new BadRequestException('drop must be row indexes');
    }
    return index;
  });
}

function asHttp(error: unknown): unknown {
  if (error instanceof NonContiguousLanesError) {
    return new ConflictException({ message: 'lanesNotContiguous' });
  }

  if (error instanceof LaneTakenError) {
    // Named, both of them: which lane, and who is in it. "There is a conflict"
    // sends the operator hunting across a six-lane grid for it.
    return new ConflictException({
      message: 'laneTaken',
      lane: error.laneName,
      holder: error.holder,
    });
  }

  if (error instanceof DuplicateBookingError) {
    return new ConflictException({ message: 'alreadyThere' });
  }

  /*
   * The site is shut then — and *why*, in parts the interface can compose.
   *
   * `reason` plus the hours, never the trigger's own sentence: it is English
   * prose from a migration, and an operator working in Portuguese should not be
   * shown it. This was the whole of Rui's second report — the drop was refused
   * correctly and the screen said only "não foi possível colocar aqui".
   */
  if (error instanceof ClosedError) {
    return new ConflictException({
      message: 'closed',
      reason: error.reason,
      opensAt: error.opensAt,
      closesAt: error.closesAt,
    });
  }

  return error;
}

function readTarget(body: Record<string, unknown>): BookingTarget {
  const weekday = Number(body['weekday']);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new BadRequestException('weekday must be 1..7');
  }

  const rawSlot = body['slotId'];
  const slotId = typeof rawSlot === 'string' && rawSlot.trim() !== '' ? rawSlot.trim() : null;

  /*
   * A time is only accepted where there is no slot.
   *
   * With a slot, the slot's own hours are the truth — letting the caller send
   * both would be two answers to "when", and the one that lost would depend on
   * the order this function happened to read them in.
   */
  const rawTime = body['startTime'];
  let startTime: string | null = null;
  if (slotId === null) {
    if (typeof rawTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime.trim())) {
      throw new BadRequestException('startTime is required when there is no slot');
    }
    startTime = rawTime.trim();
  }

  const rawLanes = body['laneIds'];
  if (!Array.isArray(rawLanes)) throw new BadRequestException('laneIds must be a list');
  if (rawLanes.length > 24) throw new BadRequestException('too many lanes');

  const laneIds = rawLanes.map((lane) => {
    if (typeof lane !== 'string' || lane.trim() === '') {
      throw new BadRequestException('each lane must be an id');
    }
    return lane.trim();
  });

  // A duplicated id would make a two-lane span look like a three-lane one and
  // would insert the same row twice into `booking_lane`.
  if (new Set(laneIds).size !== laneIds.length) {
    throw new BadRequestException('laneIds must be distinct');
  }

  /*
   * An explicit length, when the block's edge was dragged.
   *
   * The same bounds `class_schedule` itself carries — five minutes is not a
   * swimming lesson and neither is eight hours. Absent means "take the slot's
   * length", which is what an ordinary move does.
   */
  const rawDuration = body['durationMinutes'];
  let durationMinutes: number | null = null;
  if (rawDuration !== null && rawDuration !== undefined && rawDuration !== '') {
    const minutes = Number(rawDuration);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
      throw new BadRequestException('durationMinutes must be between 5 and 480');
    }
    durationMinutes = minutes;
  }

  return { weekday, slotId, startTime, laneIds, durationMinutes };
}
