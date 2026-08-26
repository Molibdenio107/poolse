import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { UserJSON, WebhookEvent } from '@clerk/backend';
import type { Request } from 'express';
import { Webhook } from 'svix';
import { deactivateAppUser, provisionAppUser } from '../identity/identity.repository.js';

/**
 * Clerk → Poolse user sync.
 *
 * Excluded from both auth middlewares: Clerk is not a signed-in user and carries
 * no bearer token. The signature check below is the *entire* authentication for
 * this route, which is why it runs before anything reads the body, and why an
 * absent signing secret is a startup-level error rather than a skipped check.
 */
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const event = verify(req);

    switch (event.type) {
      case 'user.created':
      case 'user.updated': {
        const data = event.data;
        const id = await provisionAppUser({
          clerkUserId: data.id,
          email: primaryEmail(data),
          firstName: data.first_name,
          lastName: data.last_name,
          avatarUrl: data.image_url,
          // Clerk's own timestamp, not now(). Deliveries retry and arrive out of
          // order; the migration uses this to discard a stale event instead of
          // reverting the cache to older values.
          eventAt: new Date(data.updated_at),
        });
        this.logger.log(`${event.type}: app_user ${id}`);
        break;
      }

      case 'user.deleted': {
        const clerkUserId = event.data.id;
        if (!clerkUserId) {
          this.logger.warn('user.deleted arrived without an id; ignoring');
          break;
        }
        // No timestamp on a deletion payload, so the receive time is the best
        // available. Deletions are terminal, so ordering matters less here.
        const id = await deactivateAppUser(clerkUserId, new Date());
        this.logger.log(
          id ? `user.deleted: app_user ${id} marked deleted` : `user.deleted: ${clerkUserId} unknown here`,
        );
        break;
      }

      default:
        // Organization and session events are Clerk-side concepts Poolse does not
        // mirror — organizations live in Postgres. Acknowledged so Clerk stops
        // retrying, and logged so an unexpected subscription is visible.
        this.logger.debug(`Ignoring ${event.type}`);
    }

    return { received: true };
  }
}

function verify(req: RawBodyRequest<Request>): WebhookEvent {
  const secret = process.env['CLERK_WEBHOOK_SIGNING_SECRET'];
  if (!secret) throw new Error('CLERK_WEBHOOK_SIGNING_SECRET is not set');

  // Signature is computed over the exact bytes Clerk sent. A re-serialised
  // req.body would not match, which is why main.ts enables rawBody.
  const payload = req.rawBody;
  if (!payload) {
    throw new Error('Raw body unavailable — NestFactory.create needs { rawBody: true }');
  }

  try {
    return new Webhook(secret).verify(payload, {
      'svix-id': req.header('svix-id') ?? '',
      'svix-timestamp': req.header('svix-timestamp') ?? '',
      'svix-signature': req.header('svix-signature') ?? '',
    }) as WebhookEvent;
  } catch {
    throw new UnauthorizedException('Invalid webhook signature');
  }
}

function primaryEmail(data: UserJSON): string | null {
  const primary = data.email_addresses.find(
    (address) => address.id === data.primary_email_address_id,
  );
  return primary?.email_address ?? data.email_addresses[0]?.email_address ?? null;
}
