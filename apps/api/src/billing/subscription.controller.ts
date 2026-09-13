import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  anyPriceConfigured,
  appUrl,
  BILLING_INTERVALS,
  isBillingInterval,
  priceIdFor,
  stripeClient,
  stripeEnabled,
  yearlySavingPercent,
  type BillingInterval,
} from './stripe.js';
import {
  readCustomerId,
  readSubscription,
  rememberCustomer,
  type OrganizationSubscription,
} from './subscription.repository.js';

/**
 * What the club pays Poolse — slice 2.4, narrowed 13 September 2026.
 *
 * **The owner, and nobody else.** The first version let an admin read it on the
 * grounds that somebody has to know the trial ends on Friday; Rui reversed that
 * the same day, and the narrower rule is the better one. What Poolse charges the
 * club is the owner's own business — it is their card, their renewal and their
 * decision to cancel — and an office manager who administers a club is not
 * automatically entitled to it, for the same reason they are not entitled to the
 * owner's salary. There is exactly one owner per tenant precisely so that "who
 * pays" has an answer.
 *
 * It lives under **O meu perfil** rather than in the main menu for the same
 * reason: it is a fact about the account rather than about the club's work.
 *
 * **Everything works with Stripe absent.** No key means `configured: false`, the
 * plans come back unpriced, and the screen says so — the free pilot and every
 * development machine live there, and a module that threw at boot would make
 * them a broken application rather than one that does not sell anything yet.
 *
 * **Poolse never holds a card.** Checkout and the customer portal are Stripe's
 * own hosted pages; what crosses back is a URL to send somebody to. That is the
 * whole reason to use them: a payment form on our side is a PCI question we have
 * no reason to answer.
 */

/**
 * One of the two ways to pay for the one plan — POOLSE-60.
 *
 * An unpriced interval comes back with nulls rather than being left out: both
 * are the product, and a page showing one because the dashboard was half
 * finished would be a worse lie than an honest *valor por definir*.
 */
export interface IntervalOffer {
  interval: BillingInterval;
  amountCents: number | null;
  currency: string | null;
}

export interface SubscriptionView {
  subscription: OrganizationSubscription;
  intervals: IntervalOffer[];
  /**
   * What yearly saves against twelve monthly payments, as a whole percent.
   *
   * Computed on the API so *poupa 17%* is a sentence the page renders rather
   * than a sum it does. Null unless both prices are known and yearly is
   * actually cheaper.
   */
  yearlySavingPercent: number | null;
  /** Stripe is wired up *and* at least one interval has a price. */
  configured: boolean;
  /**
   * Whether this caller may start or change it.
   *
   * True for everybody who can reach the endpoint at all, since that is now only
   * the owner. It stays on the response because the screen reads it: a button
   * offered on a guess rather than on an answer is how the two drift apart.
   */
  canManage: boolean;
}

/**
 * The prices, cached.
 *
 * A page view would otherwise be three calls to Stripe for figures that change
 * about once a year. Five minutes is short enough that a correction in the
 * dashboard shows up while somebody is still looking at the screen, and long
 * enough that a club refreshing does not hammer an API Poolse pays nothing for
 * but is rate-limited on.
 */
const PRICE_TTL_MS = 5 * 60 * 1000;
let priceCache: { at: number; intervals: IntervalOffer[] } | null = null;

export function resetPriceCache(): void {
  priceCache = null;
}

@Controller('subscription')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  @Get()
  async read(): Promise<SubscriptionView> {
    requireRole('owner');
    const { organizationId } = currentTenant();

    const subscription = await readSubscription(organizationId);
    if (subscription === null) throw new NotFoundException('No such organization');

    const intervals = await offers(this.logger);

    return {
      subscription,
      intervals,
      yearlySavingPercent: yearlySavingPercent(
        amountOf(intervals, 'monthly'),
        amountOf(intervals, 'yearly'),
      ),
      configured: stripeEnabled() && anyPriceConfigured(),
      /*
       * Always true now that only the owner reaches this at all. Kept as a field
       * rather than removed: the screen asks it rather than assuming, so the day
       * a second role is let in — a bookkeeper, say — the answer moves in one
       * place instead of in every button.
       */
      canManage: hasRole('owner'),
    };
  }

  /**
   * Start paying — a Stripe Checkout session, returned as a URL to go to.
   *
   * The customer is made once and remembered, so a club that abandons a checkout
   * and comes back does not accumulate customers; `client_reference_id` carries
   * the organization so an event can be traced back to a club even before the
   * customer id lands, and the subscription metadata carries it for the same
   * reason.
   */
  @Post('checkout')
  async checkout(@Body() body: Record<string, unknown>): Promise<{ url: string }> {
    requireRole('owner');
    const { organizationId } = currentTenant();

    const interval = readInterval(body['interval']);
    const priceId = priceIdFor(interval);
    if (!stripeEnabled() || priceId === null) {
      throw new ServiceUnavailableException({
        code: 'billing_not_configured',
        message: 'Billing is not configured on this installation',
      });
    }

    const subscription = await readSubscription(organizationId);
    if (subscription === null) throw new NotFoundException('No such organization');

    /*
     * A club that already pays is sent to the portal instead, not through a
     * second checkout. Two subscriptions against one customer is two charges a
     * month and a support conversation nobody enjoys.
     */
    if (subscription.hasSubscription) {
      throw new ConflictException({
        code: 'already_subscribed',
        message: 'This organization already has a subscription',
      });
    }

    const stripe = stripeClient();
    const customerId = await customerFor(organizationId, subscription);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: organizationId,
      subscription_data: { metadata: { organization_id: organizationId } },
      // Back to the same screen either way. The success page says nothing about
      // what happened: the webhook is what makes a subscription true, and a page
      // that claimed otherwise would be guessing ahead of it.
      success_url: appUrl('/dashboard/profile/subscription?checkout=done'),
      cancel_url: appUrl('/dashboard/profile/subscription?checkout=cancelled'),
      locale: 'pt',
      allow_promotion_codes: true,
    });

    if (session.url === null) {
      throw new ServiceUnavailableException({
        code: 'checkout_failed',
        message: 'Stripe did not return a checkout URL',
      });
    }

    return { url: session.url };
  }

  /**
   * The customer portal — change the card, see the receipts, cancel.
   *
   * Stripe's page rather than ours, and that is most of the value of this slice:
   * everything a club wants to do with a subscription after starting it is a
   * screen somebody else maintains, in a flow that is already compliant.
   */
  @Post('portal')
  async portal(): Promise<{ url: string }> {
    requireRole('owner');
    const { organizationId } = currentTenant();

    if (!stripeEnabled()) {
      throw new ServiceUnavailableException({
        code: 'billing_not_configured',
        message: 'Billing is not configured on this installation',
      });
    }

    const customerId = await readCustomerId(organizationId);
    if (customerId === null) {
      // Nothing to manage: they have never checked out. The screen offers the
      // plans instead, which is what it already shows.
      throw new ConflictException({
        code: 'no_customer',
        message: 'This organization has never subscribed',
      });
    }

    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: appUrl('/dashboard/profile/subscription'),
      locale: 'pt',
    });

    return { url: session.url };
  }
}

/** The customer for this club, made once and remembered. */
async function customerFor(
  organizationId: string,
  subscription: OrganizationSubscription,
): Promise<string> {
  const existing = await readCustomerId(organizationId);
  if (existing !== null) return existing;

  const customer = await stripeClient().customers.create({
    name: subscription.name,
    metadata: { organization_id: organizationId },
  });

  await rememberCustomer(organizationId, customer.id);
  return customer.id;
}

/**
 * What each interval costs, from Stripe.
 *
 * An interval with no price configured comes back with nulls rather than being
 * omitted: both are the product, and a page that showed one of them because
 * somebody had not finished the dashboard would be a worse lie than an honest
 * "valor por definir" — which is what the marketing page has said all along.
 *
 * A Stripe outage answers the same way. This screen exists to tell a club where
 * it stands; a 502 because a price lookup failed would take that away over a
 * figure they could also read on the public site.
 */
async function offers(logger: Logger): Promise<IntervalOffer[]> {
  if (!stripeEnabled()) {
    return BILLING_INTERVALS.map((interval) => ({
      interval,
      amountCents: null,
      currency: null,
    }));
  }

  const cached = priceCache;
  if (cached !== null && Date.now() - cached.at < PRICE_TTL_MS) return cached.intervals;

  const stripe = stripeClient();
  const intervals: IntervalOffer[] = [];

  for (const interval of BILLING_INTERVALS) {
    const priceId = priceIdFor(interval);
    if (priceId === null) {
      intervals.push({ interval, amountCents: null, currency: null });
      continue;
    }

    try {
      const price = await stripe.prices.retrieve(priceId);
      intervals.push({
        interval,
        amountCents: price.unit_amount,
        currency: price.currency.toUpperCase(),
      });
    } catch (error) {
      logger.warn(`Could not read the ${interval} price: ${String(error)}`);
      intervals.push({ interval, amountCents: null, currency: null });
    }
  }

  priceCache = { at: Date.now(), intervals };
  return intervals;
}

/** One offer's amount, for the saving. Null where it is not priced. */
function amountOf(offers: readonly IntervalOffer[], interval: BillingInterval): number | null {
  return offers.find((offer) => offer.interval === interval)?.amountCents ?? null;
}

function readInterval(value: unknown): BillingInterval {
  if (typeof value !== 'string' || !isBillingInterval(value)) {
    throw new BadRequestException({ code: 'invalid_interval', field: 'interval' });
  }
  return value;
}
