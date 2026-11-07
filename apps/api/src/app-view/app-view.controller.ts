import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { readSearch } from '../common/search.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { currentTenant } from '../tenant/tenant.context.js';
import {
  APP_VIEW_HATS,
  AppViewRefused,
  leaveView,
  listViews,
  startView,
  viewablePeople,
  type AppViewEntry,
  type AppViewHat,
  type ViewablePerson,
} from './app-view.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readHat(value: unknown): AppViewHat {
  if (typeof value === 'string' && (APP_VIEW_HATS as readonly string[]).includes(value)) {
    return value as AppViewHat;
  }
  throw new BadRequestException({ code: 'view_hat', message: 'No such home' });
}

/**
 * Seeing the app as a real person — POOLSE-188. Owner and admin; a support
 * session is an admin here, and `resolve_memberships` gives it that role only
 * while its grant is live. An instructor or a family is refused (QA 8).
 */
@CoreRoute()
@Controller('app-view')
export class AppViewController {
  @Get('people')
  async people(
    @Query('hat') hat?: string,
    @Query('search') search?: string,
  ): Promise<{ people: ViewablePerson[]; more: boolean }> {
    requireRole('owner', 'admin');
    return viewablePeople(currentTenant().organizationId, readHat(hat), readSearch(search));
  }

  @Post()
  async start(@Body() body: Record<string, unknown>): Promise<{ id: string; expiresAt: string }> {
    requireRole('owner', 'admin');
    const { organizationId, support } = currentTenant();
    const hat = readHat(body['hat']);
    const viewed = typeof body['membershipId'] === 'string' ? body['membershipId'] : '';
    if (!UUID.test(viewed)) throw new NotFoundException('No such person');

    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (support === true && reason === '') {
      throw new BadRequestException({ fields: { reason: 'appView.reasonRequired' } });
    }
    if (reason.length > 500) {
      throw new BadRequestException({ fields: { reason: 'appView.reasonTooLong' } });
    }

    try {
      return await startView(organizationId, {
        hat,
        viewedMembershipId: viewed,
        // Only support says why; an owner's view needs no reason (rule 6).
        reason: support === true ? reason : null,
      });
    } catch (error) {
      if (!(error instanceof AppViewRefused)) throw error;
      if (error.refusal === 'owner') {
        throw new ForbiddenException({ code: 'view_owner', message: 'appView.refused.owner' });
      }
      throw new NotFoundException('No such person');
    }
  }

  /** *Sair*: the one write a view allows, and the reader's own. */
  @Post('leave')
  @HttpCode(204)
  async leave(): Promise<void> {
    const { organizationId, viewing } = currentTenant();
    if (viewing == null) requireRole('owner', 'admin');
    await leaveView(organizationId);
  }

  /** *Vistas da app*. The Owner's alone, support's views included (rule 9). */
  @Get('history')
  async history(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<Paginated<AppViewEntry>> {
    requireRole('owner');
    if (currentTenant().support === true) throw new ForbiddenException();
    return listViews(currentTenant().organizationId, readPageQuery(page, limit));
  }
}
