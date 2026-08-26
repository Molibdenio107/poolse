import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { currentAuth } from '../auth/auth.context.js';
import {
  listMemberships,
  setPreferences,
  type AppUserSummary,
  type MembershipSummary,
  type Preferences,
} from './identity.repository.js';
import { ensureAppUser } from './identity.service.js';

interface MeResponse {
  user: AppUserSummary;
  memberships: MembershipSummary[];
}

interface PreferencesBody {
  locale?: unknown;
  theme?: unknown;
}

/**
 * Kept in step with `app_user_locale_supported` and the message catalogues in
 * apps/web/src/messages. Adding one means a migration and a translation file, so
 * three places — the constraint is what stops the other two being forgotten.
 */
const SUPPORTED_LOCALES = ['pt-PT', 'en'];
const SUPPORTED_THEMES = ['light', 'dark', 'system'];

/**
 * Identity without a tenant — slice 0.4's end-to-end proof.
 *
 * Excluded from TenantMiddleware on purpose: this is the one authenticated route
 * that must answer before an organization is known, because it is what tells the
 * client which organizations there are to choose from. Everything else in the API
 * runs tenant-scoped.
 *
 * `memberships` is empty for a fresh signup and stays empty until invitations
 * exist (slice 0.5). That is a correct answer, not an error.
 */
@Controller('me')
export class MeController {
  @Get()
  async me(): Promise<MeResponse> {
    const { clerkUserId } = currentAuth();

    const user = await ensureAppUser(clerkUserId);
    const memberships = await listMemberships(clerkUserId);

    return { user, memberships };
  }

  /**
   * The only thing about themselves a person can change here. Clerk owns the
   * name, the email and the password; the language and the theme are Poolse's,
   * because Clerk has never heard of either.
   *
   * PATCH rather than PUT: sending one field must not reset the other, since the
   * locale switcher and the theme toggle are separate controls that would
   * otherwise overwrite each other.
   */
  @Patch('preferences')
  async updatePreferences(@Body() body: PreferencesBody): Promise<Preferences> {
    const { clerkUserId } = currentAuth();

    const locale = optional(body.locale, SUPPORTED_LOCALES, 'locale');
    const theme = optional(body.theme, SUPPORTED_THEMES, 'theme');
    if (locale === null && theme === null) {
      throw new BadRequestException('Nothing to change: send a locale, a theme, or both');
    }

    // Provision first: someone can reach for the language switch before the
    // webhook has landed, and being told "no such account" while looking at your
    // own signed-in name is the worst kind of error.
    await ensureAppUser(clerkUserId);

    return setPreferences(clerkUserId, locale, theme);
  }
}

/** Absent means "leave it alone"; present but unsupported is a mistake worth naming. */
function optional(value: unknown, supported: string[], field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !supported.includes(value)) {
    throw new BadRequestException(`Unsupported ${field}: expected one of ${supported.join(', ')}`);
  }
  return value;
}
