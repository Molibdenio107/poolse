import { BadRequestException, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MIN_SEARCH_LENGTH } from '../common/search.js';
import { SEARCH } from '../common/throttle.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { MAX_SEARCH_LENGTH, readTerm, search, type SearchResults } from './search.repository.js';

const NOTHING: SearchResults = { students: [], guardians: [], staff: [], turmas: [] };

/**
 * Ctrl+K finds people, turmas and clubs — POOLSE-235 (Rui, 19-11-2026).
 *
 * **The office and instructors only**, refused in the first line for everybody
 * else: maintenance and families keep the palette's pages. The owner and admins
 * search the whole register; an instructor their own turmas' students, by name.
 * The clubs a reader belongs to need no request — the palette has them from
 * `/me`. Throttled per person below the global ceiling.
 */
@CoreRoute()
@Controller('search')
export class SearchController {
  @Get()
  @Throttle(SEARCH)
  async find(@Query('q') q?: string): Promise<SearchResults> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();

    const raw = typeof q === 'string' ? q : '';
    if (raw.length > MAX_SEARCH_LENGTH) {
      throw new BadRequestException({ code: 'search_too_long', message: `At most ${MAX_SEARCH_LENGTH} characters` });
    }
    const term = readTerm(raw);
    if (term.text.length < MIN_SEARCH_LENGTH) return NOTHING;

    return search(organizationId, { membershipId, office: hasRole('owner', 'admin') }, term);
  }
}
