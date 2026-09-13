import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { stripeClient, stripeEnabled } from '../billing/stripe.js';
import { readChange } from '../billing/stripe-events.js';
import { applyStripeEvent } from '../billing/subscription.repository.js';

/**
 * Stripe → Poolse — slice 2.4.
 *
 * **This is the half that makes a subscription true.** A checkout session
 * finishing tells the browser something; it does not tell Poolse anything a
 * browser could not have made up. Every column this feature writes is written
 * here, from an event Stripe signed.
 *
 * Excluded from both auth middlewares, like the Clerk webhook: Stripe is not a
 * signed-in user and carries no bearer token. **The signature check is the
 * entire authentication for this route**, which is why it runs before anything
 * reads the body and why it uses the raw bytes rather than the parsed object —
 * a re-serialised body does not produce the same signature, and the check would
 * fail for everyone or, worse, be quietly removed by somebody making it pass.
 *
 * **It answers 200 to almost everything.** An event type Poolse does not handle,
 * a customer it does not know, a redelivery of one already applied — all 200,
 * all recorded. Stripe retries anything that is not a 2xx and disables an
 * endpoint that keeps failing, so a 500 over an event we never cared about would
 * eventually take the events we do care about with it.
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const event = verify(req);

    const change = readChange(event);
    if (change === null) {
      // Not one of ours. Not recorded either: `stripe_event` is the trail of
      // what Poolse *did*, and an entry per invoice-item event would bury the
      // handful that moved something.
      this.logger.debug(`Ignoring ${event.type}`);
      return { received: true };
    }

    const applied = await applyStripeEvent(
      event.id,
      event.type,
      change.customerId,
      change.change,
    );

    this.logger.log(
      `${event.type} ${event.id}: ${applied.outcome}` +
        (applied.organizationId === null ? '' : ` for ${applied.organizationId}`) +
        // The keys that moved, never their values: a log line is the one place
        // this feature's state could leak into a third party's product.
        (Object.keys(applied.changed).length === 0
          ? ''
          : ` (${Object.keys(applied.changed).join(', ')})`),
    );

    return { received: true };
  }
}

/**
 * The signature, which is the whole of the authentication.
 *
 * `constructEvent` from the SDK rather than a hand-rolled HMAC: it does the
 * timestamp tolerance and the constant-time comparison, and getting either of
 * those subtly wrong is not the kind of mistake that shows up in testing.
 *
 * An absent signing secret is a **503, not a skipped check**. The alternative —
 * accepting unsigned events when the secret is missing — is an endpoint that
 * anybody on the internet can use to mark any club as paid, arrived at by a
 * deployment forgetting one variable.
 */
function verify(req: RawBodyRequest<Request>): Stripe.Event {
  const secret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!stripeEnabled() || secret === undefined || secret.trim() === '') {
    throw new ServiceUnavailableException('Stripe is not configured on this installation');
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string' || req.rawBody === undefined) {
    throw new UnauthorizedException('Missing Stripe signature');
  }

  try {
    return stripeClient().webhooks.constructEvent(req.rawBody, signature, secret.trim());
  } catch (error) {
    throw new UnauthorizedException(`Invalid Stripe signature: ${String(error)}`);
  }
}
