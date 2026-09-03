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
  type BookingTarget,
} from './bookings.repository.js';

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

  if (error instanceof ClosedError) {
    return new ConflictException({ message: 'closed', detail: error.detail });
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

  return { weekday, slotId, startTime, laneIds };
}
