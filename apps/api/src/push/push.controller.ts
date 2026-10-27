import { BadRequestException, Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  listOwnSubscriptions,
  pushConfig,
  revokeOwnSubscription,
  saveSubscription,
  type PushSubscriptionRow,
} from './push.js';

/** Everybody who can be told something on their phone — families and staff. */
const ANY_MEMBER = ['owner', 'admin', 'instructor', 'maintenance', 'guardian', 'student'] as const;

/**
 * *Avisos neste telemóvel* — POOLSE-90 slice 4. Own device only: a person turns
 * their own phone on and off, and never sees or touches anybody else's.
 */
@CoreRoute()
@Controller('push')
export class PushController {
  /** Whether push exists here at all, and the key a browser subscribes with. */
  @Get('config')
  config(): { available: boolean; publicKey: string | null } {
    requireRole(...ANY_MEMBER);
    const config = pushConfig();
    return { available: config !== null, publicKey: config?.publicKey ?? null };
  }

  @Get('subscriptions')
  async mine(): Promise<{ subscriptions: PushSubscriptionRow[] }> {
    requireRole(...ANY_MEMBER);
    const { organizationId, membershipId } = currentTenant();
    return { subscriptions: await listOwnSubscriptions(organizationId, membershipId) };
  }

  @Post('subscriptions')
  async subscribe(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole(...ANY_MEMBER);
    if (pushConfig() === null) throw new NotFoundException({ code: 'push_off', message: 'Push is not configured' });
    const { organizationId, membershipId } = currentTenant();
    return saveSubscription(organizationId, membershipId, parseSubscription(body));
  }

  /** Off — by the endpoint the browser holds. Idempotent: an unknown endpoint is already off. */
  @Post('subscriptions/revoke')
  async revoke(@Body() body: Record<string, unknown>): Promise<{ revoked: boolean }> {
    requireRole(...ANY_MEMBER);
    const endpoint = body['endpoint'];
    if (typeof endpoint !== 'string' || endpoint === '') {
      throw new BadRequestException({ message: 'endpoint is required' });
    }
    const { organizationId, membershipId } = currentTenant();
    return { revoked: await revokeOwnSubscription(organizationId, membershipId, { endpoint }) };
  }
}

function parseSubscription(body: Record<string, unknown>): {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string | null;
} {
  const endpoint = body['endpoint'];
  const keys = body['keys'] as Record<string, unknown> | undefined;
  const p256dh = keys?.['p256dh'];
  const auth = keys?.['auth'];
  if (
    typeof endpoint !== 'string' ||
    !/^https:\/\//.test(endpoint) ||
    endpoint.length > 2000 ||
    typeof p256dh !== 'string' ||
    typeof auth !== 'string' ||
    p256dh === '' ||
    auth === '' ||
    p256dh.length > 200 ||
    auth.length > 100
  ) {
    throw new BadRequestException({ message: 'A browser push subscription is required' });
  }
  const raw = body['label'];
  const label = typeof raw === 'string' && raw.trim() !== '' ? raw.trim().slice(0, 120) : null;
  return { endpoint, p256dh, auth, label };
}
