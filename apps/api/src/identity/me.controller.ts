import { BadRequestException, Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { currentAuth } from '../auth/auth.context.js';
import {
  listMemberships,
  setPreferences,
  setProfile,
  type AppUserSummary,
  type MembershipSummary,
  type Preferences,
} from './identity.repository.js';
import { ensureAppUser, updateClerkName } from './identity.service.js';

interface MeResponse {
  user: AppUserSummary;
  memberships: MembershipSummary[];
}

interface PreferencesBody {
  locale?: unknown;
  theme?: unknown;
}

interface ProfileBody {
  firstName?: unknown;
  lastName?: unknown;
  birthDate?: unknown;
  contactPhone?: unknown;
  locale?: unknown;
  theme?: unknown;
}

/**
 * Field name to translation key, never to prose.
 *
 * The API has no message catalogues and no idea what language the person reads.
 * Sending "Data de nascimento inválida" from here would be the first untranslated
 * string in the product, and CLAUDE.md is explicit that there are none.
 */
type FieldErrors = Record<string, string>;

const MAX_NAME = 100;

/** Deliberately permissive. An international phone number has no shape worth enforcing. */
const PHONE_SHAPE = /^[0-9+()./\s-]{6,30}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST_BIRTH_DATE = '1900-01-01';

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

  /**
   * The profile screen — backlog round 3, story 1.
   *
   * PUT, not PATCH, and unlike `preferences` that is the right verb: this backs
   * one form that submits every field at once, so an absent phone number means
   * the person cleared it rather than that they did not mention it.
   *
   * The name goes to Clerk and comes back through the cache; everything else is
   * written directly. See `updateClerkName` for why that asymmetry is not
   * negotiable.
   */
  @Put('profile')
  async updateProfile(@Body() body: ProfileBody): Promise<MeResponse> {
    const { clerkUserId } = currentAuth();

    const errors: FieldErrors = {};

    const firstName = name(body.firstName, 'firstName', errors);
    const lastName = name(body.lastName, 'lastName', errors);
    const birthDate = birth(body.birthDate, errors);
    const contactPhone = phone(body.contactPhone, errors);
    const locale = choice(body.locale, SUPPORTED_LOCALES, 'locale', errors);
    const theme = choice(body.theme, SUPPORTED_THEMES, 'theme', errors);

    // Every field is reported at once. Validating one at a time and stopping at
    // the first failure makes a person fix a form one round trip per mistake.
    if (Object.keys(errors).length > 0) {
      throw new BadRequestException({
        code: 'validation_failed',
        message: 'One or more fields are invalid',
        fields: errors,
      });
    }

    // Provision before writing, for the same reason `preferences` does: somebody
    // can reach their own profile before the webhook has landed.
    await ensureAppUser(clerkUserId);

    // Clerk first. If it refuses, nothing here has changed yet, and the person
    // sees a failed save rather than a half-applied one.
    const user = await updateClerkName(clerkUserId, firstName, lastName);
    if (!user) throw new BadRequestException('This account no longer exists');

    const saved = await setProfile(clerkUserId, {
      locale: locale as string,
      theme: theme as string,
      birthDate,
      contactPhone,
    });

    const memberships = await listMemberships(clerkUserId);

    return { user: { ...user, ...saved }, memberships };
  }
}

/** Blank and absent are the same answer: this person has not given one. */
function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function name(value: unknown, field: string, errors: FieldErrors): string | null {
  const text = trimmed(value);
  if (text !== null && text.length > MAX_NAME) {
    errors[field] = 'profile.errors.nameTooLong';
    return null;
  }
  return text;
}

function phone(value: unknown, errors: FieldErrors): string | null {
  const text = trimmed(value);
  if (text !== null && !PHONE_SHAPE.test(text)) {
    errors['contactPhone'] = 'profile.errors.phoneShape';
    return null;
  }
  return text;
}

/**
 * A calendar day, checked as one.
 *
 * `new Date('2026-02-31')` does not throw — it rolls over to the 3rd of March,
 * so the only way to know the input was a real date is to format it back and see
 * whether it still says what it said.
 */
function birth(value: unknown, errors: FieldErrors): string | null {
  const text = trimmed(value);
  if (text === null) return null;

  if (!ISO_DATE.test(text)) {
    errors['birthDate'] = 'profile.errors.birthDateInvalid';
    return null;
  }

  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    errors['birthDate'] = 'profile.errors.birthDateInvalid';
    return null;
  }

  if (text < EARLIEST_BIRTH_DATE) {
    errors['birthDate'] = 'profile.errors.birthDateTooEarly';
    return null;
  }

  // Compared as strings, in UTC, because both sides are calendar days rather
  // than instants and a timezone offset would make "today" wrong for half the
  // world for part of the day.
  if (text > new Date().toISOString().slice(0, 10)) {
    errors['birthDate'] = 'profile.errors.birthDateFuture';
    return null;
  }

  return text;
}

function choice(
  value: unknown,
  supported: string[],
  field: string,
  errors: FieldErrors,
): string | null {
  if (typeof value !== 'string' || !supported.includes(value)) {
    errors[field] = `profile.errors.${field}Invalid`;
    return null;
  }
  return value;
}

/** Absent means "leave it alone"; present but unsupported is a mistake worth naming. */
function optional(value: unknown, supported: string[], field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !supported.includes(value)) {
    throw new BadRequestException(`Unsupported ${field}: expected one of ${supported.join(', ')}`);
  }
  return value;
}
