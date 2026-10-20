import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { syncSeasonLessons, type LessonSync } from '../classes/lesson-sync.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireCanArchive } from '../tenant/roles.js';
import {
  RestoreRefusal,
  listArchive,
  listArchiveActors,
  restoreArchive,
  type ArchiveEntry,
  type Restored,
} from './archive.repository.js';
import { restorableByKind } from './restorable.js';
import { CoreRoute } from '../tenant/modules.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Arquivados — POOLSE-78.
 *
 * Owner and Admin, by the same predicate every archive endpoint uses: whoever
 * may archive may undo it, and an Admin may restore what the Owner archived.
 * The bin is not offered to anybody else and the API refuses them, because
 * hiding a menu item is never the control.
 */
@CoreRoute()
@Controller('archive')
export class ArchiveController {
  @Get()
  async list(
    @Query('kind') kind?: string,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<Paginated<ArchiveEntry>> {
    requireCanArchive();

    const known = kind ? restorableByKind(kind) : undefined;
    if (kind && known === undefined) throw new BadRequestException({ message: 'unknownKind' });
    if (actor && !UUID.test(actor)) throw new BadRequestException({ message: 'badActor' });
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
      throw new BadRequestException({ message: 'badDate' });
    }

    const { organizationId } = currentTenant();
    return listArchive(
      organizationId,
      {
        kind: known?.kind ?? null,
        actorMembershipId: actor || null,
        from: from || null,
        to: to || null,
      },
      readPageQuery(page, limit),
    );
  }

  @Get('actors')
  async actors(): Promise<{ membershipId: string; name: string }[]> {
    requireCanArchive();
    return listArchiveActors(currentTenant().organizationId);
  }

  /**
   * One endpoint for the bin's *Restaurar* and the toast's *Anular*, so there is
   * no second way back to keep in step with the first.
   */
  @Post(':id/restore')
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Restored & { lessons: LessonSync }> {
    requireCanArchive();

    const { organizationId } = currentTenant();
    let restored: Restored | 'not_found';
    try {
      restored = await restoreArchive(organizationId, id);
    } catch (error) {
      if (error instanceof RestoreRefusal) {
        throw new ConflictException({ code: error.code, message: error.code, ...error.figures });
      }
      throw error;
    }
    if (restored === 'not_found') throw new NotFoundException({ message: 'archiveEntryNotFound' });

    // A turma is back on its pattern; its lessons from today on follow, as they
    // do after every other write to a pattern. Never the past.
    const lessons = restored.kind === 'class_group' ? await syncSeasonLessons(organizationId) : null;
    return { ...restored, lessons };
  }
}
