import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole } from '../tenant/roles.js';
import { DraftSeasonError, readOccupancy, type Occupancy } from './occupancy.repository.js';

/**
 * How much of the water is sold — POOLSE-52.
 *
 * **One endpoint for the whole shape.** Several small ones would each have to
 * re-derive the denominator, and the denominator is the part that is easy to get
 * wrong: available lane-hours have to come from the same dated calendar as the
 * sold ones or every club looks under-booked.
 *
 * **Occupancy is open; money is not** — criterion 10. An instructor should be
 * able to see that Tuesday mornings are empty; what a school pays for its lane
 * is not theirs to read. So `contractedCents` is computed only for an owner or
 * admin and comes back null for everybody else, rather than the whole request
 * being refused for wanting a figure they can have.
 */
@Controller('facilities/:facilityId/occupancy')
export class OccupancyController {
  @Get()
  async read(
    @Param('facilityId') facilityId: string,
    @Query('seasonId') seasonId?: string,
  ): Promise<Occupancy> {
    const { organizationId } = currentTenant();

    let occupancy: Occupancy | null;
    try {
      occupancy = await readOccupancy(
        organizationId,
        facilityId,
        readOptionalId(seasonId),
        hasRole('owner', 'admin'),
      );
    } catch (error) {
      if (error instanceof DraftSeasonError) {
        /*
         * A draft has no dated sessions, so there is nothing to measure —
         * QA 52.12, decided and named rather than left as a zero.
         *
         * Answering 0% for a fully-planned season would be worse than refusing,
         * and computing it from the weekly pattern instead would be a second
         * definition of every figure in the repository, which criterion 8
         * forbids.
         */
        throw new ConflictException({
          message: 'draftSeason',
          season: error.seasonName,
        });
      }
      throw error;
    }

    if (occupancy === null) throw new NotFoundException('No such site, or no season');
    return occupancy;
  }
}

/** An absent or blank parameter means "the published season", not "". */
function readOptionalId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}
