import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { canArchive, requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  listStaffNotes,
  NOTE_COLOURS,
  pinStaffNote,
  removeStaffNote,
  type NoteColour,
  type StaffNote,
} from './staff-notes.repository.js';

/**
 * The staff's post-it board — POOLSE-169 (Rui, 04-11-2026).
 *
 * **Every working role reads and pins; a family never does.** Taking one down
 * is its author's, or the office's for any. Core: it is how the people who work
 * here talk to each other, not a module a club buys.
 */

export const STAFF = ['owner', 'admin', 'instructor', 'maintenance'] as const;
const MAX_BODY = 500;

@CoreRoute()
@Controller('staff-notes')
export class StaffNotesController {
  @Get()
  async list(): Promise<{ notes: StaffNote[] }> {
    requireRole(...STAFF);
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) return { notes: [] };
    return { notes: await listStaffNotes(organizationId, membershipId, canArchive()) };
  }

  @Post()
  async pin(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole(...STAFF);
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();

    const text = typeof body['body'] === 'string' ? body['body'].trim() : '';
    const colour = body['colour'] ?? 'yellow';
    const fields: Record<string, string> = {};
    if (text.length === 0) fields['body'] = 'staffNotes.error.bodyRequired';
    else if (text.length > MAX_BODY) fields['body'] = 'staffNotes.error.bodyTooLong';
    if (typeof colour !== 'string' || !(NOTE_COLOURS as readonly string[]).includes(colour)) {
      fields['colour'] = 'staffNotes.error.colour';
    }
    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({ message: 'body is 1 to 500 characters; colour is one of four', fields });
    }
    return pinStaffNote(organizationId, membershipId, text, colour as NoteColour);
  }

  /**
   * Takes a note down: its author, or the office any. `undoable` says whether
   * the reader may restore it from the bin, which is the office's — an author
   * who is not is asked first, and the office can bring it back.
   */
  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ archived: true; archiveEntryId: string; undoable: boolean }> {
    requireRole(...STAFF);
    const { organizationId, membershipId } = currentTenant();
    const office = canArchive();
    const outcome = await removeStaffNote(organizationId, id, office ? null : (membershipId ?? ''));
    if (outcome === 'not_found') throw new NotFoundException();
    if (outcome === 'forbidden') {
      throw new ForbiddenException({ code: 'not_your_note', message: 'Only its author or the office takes a note down' });
    }
    return { archived: true, archiveEntryId: outcome.archiveEntryId, undoable: office };
  }
}
