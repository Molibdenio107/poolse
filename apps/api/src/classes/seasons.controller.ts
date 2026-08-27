import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  listSeasons,
  previewReset,
  resetSeason,
  type ResetPreview,
  type Season,
} from './seasons.repository.js';

const MAX_NAME = 60;

interface SeasonsResponse {
  organizationId: string;
  seasons: Season[];
  canManage: boolean;
  /** What a reset would retire. Absent for anybody who cannot perform one. */
  preview?: ResetPreview;
  /** The name and range the dialog offers by default. */
  suggested: { name: string; startsOn: string; endsOn: string };
}

/**
 * Seasons — POOLSE-07.
 *
 * The list is readable by any member: which season is running is not a secret,
 * and every screen that filters by it needs to know. Resetting is owner and
 * admin only, refused server-side rather than merely hidden.
 */
@Controller('seasons')
export class SeasonsController {
  @Get()
  async list(): Promise<SeasonsResponse> {
    const { organizationId } = currentTenant();
    const privileged = hasRole('owner', 'admin');

    const [seasons, preview] = await Promise.all([
      listSeasons(organizationId),
      privileged ? previewReset(organizationId) : Promise.resolve(null),
    ]);

    return {
      organizationId,
      seasons,
      canManage: privileged,
      ...(preview === null ? {} : { preview }),
      suggested: suggestNext(seasons),
    };
  }

  /**
   * Archives the current season and opens a new one.
   *
   * The typed confirmation is checked here as well as in the dialog, and that is
   * not belt and braces: the dialog is a courtesy to somebody about to do
   * something they cannot undo in one click, and a request that skipped it would
   * skip the only thing standing between a mis-click and a retired season.
   */
  @Post('reset')
  async reset(@Body() body: Record<string, unknown>): Promise<{ reset: true; seasonId: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (String(body['confirm'] ?? '').trim().toUpperCase() !== 'RESET') {
      throw new BadRequestException({
        code: 'confirmation_required',
        message: 'Type RESET to confirm',
      });
    }

    const name = String(body['name'] ?? '').trim();
    if (name === '') throw new BadRequestException('The new season needs a name');
    if (name.length > MAX_NAME) {
      throw new BadRequestException(`name may be at most ${MAX_NAME} characters`);
    }

    const startsOn = date(body['startsOn'], 'startsOn');
    const endsOn = date(body['endsOn'], 'endsOn');
    if (endsOn < startsOn) {
      throw new BadRequestException('The season ends before it starts');
    }

    const outcome = await resetSeason(organizationId, name, startsOn, endsOn);
    if (outcome === null) throw new NotFoundException('There is no current season to reset');

    return { reset: true, seasonId: outcome.created.id };
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new BadRequestException(`${field} must be a date, YYYY-MM-DD`);
  }
  return value;
}

/**
 * The season the dialog offers by default — the one after the current one.
 *
 * Editable in the dialog, per the ticket's open question, but suggested rather
 * than left blank: a club resetting in June is almost always opening the year
 * that starts in September, and making them work that out is friction for
 * nothing.
 *
 * September to August, matching `seasonOf` in the web app and the migration that
 * created the first seasons.
 */
function suggestNext(seasons: Season[]): { name: string; startsOn: string; endsOn: string } {
  const active = seasons.find((season) => season.active);

  const startYear =
    active === undefined ? new Date().getUTCFullYear() : Number(active.startsOn.slice(0, 4)) + 1;

  return {
    name: `${startYear}/${startYear + 1}`,
    startsOn: `${startYear}-09-01`,
    endsOn: `${startYear + 1}-08-31`,
  };
}
