import { BadRequestException, Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { currentAuth } from '../auth/auth.context.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { ensureAppUser } from '../identity/identity.service.js';
import {
  provisionOrganization,
  reposicaoSettings,
  saveReposicaoSettings,
  type ReposicaoSettings,
} from './organizations.repository.js';

interface CreateOrganizationBody {
  name?: unknown;
  locale?: unknown;
  facilityName?: unknown;
}

interface CreateOrganizationResponse {
  organizationId: string;
  membershipId: string;
  facilityId: string;
  slug: string;
}

const MAX_NAME_LENGTH = 120;

/**
 * Authenticated but deliberately outside TenantMiddleware — like `/me`, and for
 * the same reason. Somebody creating their first organization belongs to none,
 * so there is no tenant to resolve; requiring one would make the first
 * organization impossible to create through the product.
 *
 * There is no authorization check here on purpose: anyone with an account may
 * create an organization, the same way they may sign up. What that grants is
 * ownership of a brand-new empty tenant, which is nobody else's data.
 */
@Controller('organizations')
export class OrganizationsController {
  @Post()
  async create(@Body() body: CreateOrganizationBody): Promise<CreateOrganizationResponse> {
    const { clerkUserId } = currentAuth();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length === 0) throw new BadRequestException('A name is required');
    if (name.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(`A name may be at most ${MAX_NAME_LENGTH} characters`);
    }

    // The organization row exists before any membership can point at it, and the
    // membership points at an app_user — which may not exist yet if the webhook
    // has not landed. Same fallback the dashboard relies on.
    const facilityName =
      typeof body.facilityName === 'string' ? body.facilityName.trim() : '';
    if (facilityName.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(`A facility name may be at most ${MAX_NAME_LENGTH} characters`);
    }

    const user = await ensureAppUser(clerkUserId);
    const locale = typeof body.locale === 'string' && body.locale ? body.locale : user.locale;

    // Blank is allowed and means "same as the organization". An operator with one
    // site should not have to type its name twice, and the function decides.
    return provisionOrganization(clerkUserId, name, locale, facilityName || null);
  }
}

/**
 * The club's own settings — POOLSE-21, and the first home for anything that is
 * a decision about how this club runs rather than about its data.
 *
 * Separate from `OrganizationsController` above because that one is deliberately
 * outside tenant scope (somebody creating their first organization belongs to
 * none). These reads and writes are firmly inside a tenant and inside a role
 * check, which is the opposite of that.
 */
@Controller('settings')
export class SettingsController {
  /**
   * Readable by owner and admin only.
   *
   * Not because the values are secret — a family can infer the window from the
   * expiry date on their own credit — but because a screen that shows settings
   * it will refuse to save is a screen that lies about what it is for.
   */
  @Get('reposicao')
  async read(): Promise<ReposicaoSettings> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return reposicaoSettings(organizationId);
  }

  @Patch('reposicao')
  async write(@Body() body: Record<string, unknown>): Promise<ReposicaoSettings> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    /*
     * Parsed strictly, because these are numbers a form can send as anything.
     *
     * The sane *ranges* are schema constraints rather than checks here — a value
     * typed straight into the database is refused the same way — so this only
     * has to turn form input into the right types and reject what is not a
     * number at all.
     */
    const windowDays = Number(body['windowDays']);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
      throw new BadRequestException('windowDays must be a whole number of days between 1 and 365');
    }

    /*
     * An empty cap is "no cap", not zero. A form that sends "" for an untouched
     * optional number would otherwise silently set the cap to nothing-allowed,
     * which is the same shape as the bug POOLSE-09 and 10 came from.
     */
    const rawCap = body['capPerSeason'];
    const capPerSeason =
      rawCap === null || rawCap === undefined || rawCap === '' ? null : Number(rawCap);
    if (capPerSeason !== null && (!Number.isInteger(capPerSeason) || capPerSeason < 1)) {
      throw new BadRequestException('capPerSeason must be a whole number above zero, or empty');
    }

    const mode = body['mode'];
    if (mode !== 'self_service' && mode !== 'request') {
      throw new BadRequestException('mode must be self_service or request');
    }

    return saveReposicaoSettings(organizationId, {
      enabled: body['enabled'] === true || body['enabled'] === 'true',
      windowDays,
      capPerSeason,
      backfillOnly: body['backfillOnly'] === true || body['backfillOnly'] === 'true',
      mode,
    });
  }
}
