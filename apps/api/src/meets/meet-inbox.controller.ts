import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { canArchive, requireRole } from '../tenant/roles.js';
import { readPageQuery } from '../common/pagination.js';
import { PoolseModule } from '../tenant/modules.js';
import { storageConfigured } from '../files/storage.js';
import {
  discardInbox,
  inboxFile,
  listInbox,
  pendingInboxCount,
  regenerateInboxAddress,
  type InboxList,
} from './meet-inbox.repository.js';

/**
 * *Recebidos por email* — POOLSE-114.
 *
 * Read and import: owner, admin and instructor, the people who import a meet
 * (POOLSE-81). *Rejeitar* and a new address: owner and admin, as every remove
 * is. The whole controller is the competition module's, so a club without it
 * has no address to show and no inbox to read.
 */

const TEACHING = ['owner', 'admin', 'instructor'] as const;
const OFFICE = ['owner', 'admin'] as const;
/** The 15 the ticket asks for (BA 4), whatever the caller sends. */
const INBOX_PAGE = '15';

interface InboxResponse extends InboxList {
  canManage: boolean;
  /** False where the bucket is not configured: nothing can arrive, and the page says so. */
  receiving: boolean;
}

@PoolseModule('competition')
@Controller('meet-inbox')
export class MeetInboxController {
  @Get()
  async list(@Query('page') page?: string): Promise<InboxResponse> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const list = await listInbox(organizationId, readPageQuery(page, INBOX_PAGE));
    return {
      ...list,
      canManage: canArchive(),
      receiving: list.address !== null && storageConfigured(),
    };
  }

  /** The menu's badge — the layout asks on every page, so one indexed count. */
  @Get('count')
  async count(): Promise<{ pending: number }> {
    requireRole(...TEACHING);
    return { pending: await pendingInboxCount(currentTenant().organizationId) };
  }

  /**
   * The file itself, for the import dialog's Next server action — which reads
   * it exactly as it reads one dropped on the page. Never linked in a browser.
   */
  @Get(':id/file')
  async file(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const found = await inboxFile(organizationId, id);
    if (found === null) throw new NotFoundException('No such file');
    return new StreamableFile(found.bytes, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${encodeURIComponent(found.fileName)}"`,
    });
  }

  @Post(':id/discard')
  async discard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ discarded: true }> {
    requireRole(...OFFICE);
    const { organizationId, membershipId } = currentTenant();
    const raw = typeof body?.['reason'] === 'string' ? body['reason'].trim() : '';
    if (raw.length > 500) throw new BadRequestException('reason is too long');
    const done = await discardInbox(organizationId, membershipId, id, raw === '' ? null : raw);
    if (!done) throw new NotFoundException('No such pending file');
    return { discarded: true };
  }

  @Post('address')
  async regenerate(): Promise<{ address: string | null }> {
    requireRole(...OFFICE);
    const { organizationId } = currentTenant();
    return { address: await regenerateInboxAddress(organizationId) };
  }
}
