import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  createDraft,
  discardDraft,
  listSeasons,
  NoSuchSeasonError,
  publishSeason,
  SeasonArchivedError,
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

  /**
   * Opens a draft — POOLSE-45.
   *
   * "Duplicar época" is this with `copyFrom` naming the season to copy; an empty
   * draft is the same control with nothing named. A club rebuilding its
   * timetable from scratch should not have to delete last year's grid first.
   *
   * Nothing about the published season changes, which is the whole point: a
   * draft is a plan, and `generate_sessions` refuses to run one.
   */
  @Post('drafts')
  async draft(@Body() body: Record<string, unknown>): Promise<{ season: Season }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = String(body['name'] ?? '').trim();
    if (name === '') throw new BadRequestException('The draft needs a name');
    if (name.length > MAX_NAME) {
      throw new BadRequestException(`name may be at most ${MAX_NAME} characters`);
    }

    const startsOn = date(body['startsOn'], 'startsOn');
    const endsOn = date(body['endsOn'], 'endsOn');
    if (endsOn < startsOn) throw new BadRequestException('The season ends before it starts');

    const copyFrom =
      typeof body['copyFrom'] === 'string' && body['copyFrom'].trim() !== ''
        ? body['copyFrom'].trim()
        : null;

    let season: Season | null;
    try {
      season = await createDraft(organizationId, { name, startsOn, endsOn, copyFrom });
    } catch (error) {
      if (error instanceof NoSuchSeasonError) {
        throw new NotFoundException('There is no such season to copy');
      }
      throw error;
    }

    if (season === null) throw new BadRequestException('The draft could not be created');
    return { season };
  }

  /**
   * Makes a draft the season the club is running.
   *
   * The incumbent is archived in the same statement — see `publish_season`. A
   * moment with two published seasons, or none, is a moment where every screen
   * that filters by the current season is wrong.
   */
  @Post(':seasonId/publish')
  async publish(@Param('seasonId') seasonId: string): Promise<{ published: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let published: boolean;
    try {
      published = await publishSeason(organizationId, seasonId);
    } catch (error) {
      if (error instanceof SeasonArchivedError) {
        throw new ConflictException({ message: 'seasonArchived' });
      }
      throw error;
    }

    if (!published) throw new NotFoundException('No such season');
    return { published: true };
  }

  /**
   * Throws a draft away.
   *
   * A real delete, and the one place in this schema where that is right: a draft
   * is a plan nobody acted on, with no sessions, no registers and no history.
   * "History is never destroyed" is a rule about what happened, not about what
   * somebody considered — and a draft holding turmas is refused, because by then
   * it is not a scrap of paper any more.
   */
  @Delete(':seasonId')
  async discard(@Param('seasonId') seasonId: string): Promise<{ discarded: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await discardDraft(organizationId, seasonId))) {
      throw new ConflictException({ message: 'draftNotDiscardable' });
    }
    return { discarded: true };
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
