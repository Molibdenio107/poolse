import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { currentAuth } from '../auth/auth.context.js';
import { ensureAppUser } from '../identity/identity.service.js';
import { provisionOrganization } from './organizations.repository.js';

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
