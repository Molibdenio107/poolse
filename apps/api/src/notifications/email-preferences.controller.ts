import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { withOrg } from '@poolse/db';
import { PUBLIC_EMAIL } from '../common/throttle.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  readByToken,
  readOwnPreference,
  setByToken,
  setOwnPreference,
  type PublicEmailPreference,
} from './email-preferences.js';

/**
 * Opting out of a club's general messages — POOLSE-86, slice 3.0c.
 *
 * **By the link** (`public/email/:token`): no login, because most guardians have
 * none. Two definer functions keyed on the token are the whole boundary — the
 * `public_water_page()` pattern — and every kind of miss is the same 404.
 * Throttled per token.
 */
@Controller('public/email')
export class PublicEmailPreferenceController {
  @Get(':token')
  @Throttle(PUBLIC_EMAIL)
  async read(@Param('token') token: string): Promise<PublicEmailPreference> {
    const page = await readByToken(token);
    if (page === null) throw new NotFoundException();
    return page;
  }

  @Post(':token')
  @Throttle(PUBLIC_EMAIL)
  async set(@Param('token') token: string, @Body() body: { optedOut?: unknown }): Promise<PublicEmailPreference> {
    if (typeof body.optedOut !== 'boolean') throw new BadRequestException('optedOut must be true or false');
    const page = await setByToken(token, body.optedOut);
    if (page === null) throw new NotFoundException();
    return page;
  }
}

/**
 * **On the profile**: a signed-in member's own address in the active club. Any
 * member — a guardian above all, since these are the messages families get.
 * Support has no address of its own here and is refused.
 */
@Controller('my/email-preference')
export class OwnEmailPreferenceController {
  @Get()
  async read(): Promise<{ email: string | null; optedOut: boolean }> {
    const { organizationId, email } = await self();
    if (email === null) return { email: null, optedOut: false };
    return readOwnPreference(organizationId, email);
  }

  @Put()
  async set(@Body() body: { optedOut?: unknown }): Promise<{ email: string | null; optedOut: boolean }> {
    if (typeof body.optedOut !== 'boolean') throw new BadRequestException('optedOut must be true or false');
    const { organizationId, email } = await self();
    if (email === null) throw new BadRequestException('No email address on this account');
    return setOwnPreference(organizationId, email, body.optedOut);
  }
}

async function self(): Promise<{ organizationId: string; email: string | null }> {
  requireRole('owner', 'admin', 'instructor', 'maintenance', 'guardian', 'student');
  const tenant = currentTenant();
  if (tenant.support === true) throw new ForbiddenException('Support has no address of its own here');
  // A membership with no login has no address of its own to choose for.
  if (!tenant.appUserId) return { organizationId: tenant.organizationId, email: null };
  const { rows } = await withOrg(tenant.organizationId, (tx) =>
    tx.query<{ email: string | null }>('SELECT cached_email::text AS email FROM app_user WHERE id = $1', [
      tenant.appUserId,
    ]),
  );
  const email = rows[0]?.email?.trim() ?? '';
  return { organizationId: tenant.organizationId, email: email === '' ? null : email };
}
