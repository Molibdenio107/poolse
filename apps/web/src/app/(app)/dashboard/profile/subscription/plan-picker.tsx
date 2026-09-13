'use client';

import { useTranslations } from 'next-intl';
import { Check, ExternalLink } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { formatCents } from '@/lib/money';
import type { BillingInterval, IntervalOffer } from '@/lib/api';
import { checkoutAction, portalAction } from './subscription.actions';
import type { FormState } from '../../actions';

/**
 * How to pay, and the one button that matters — POOLSE-60.
 *
 * **Three plan cards became two intervals.** There is one plan; what is left to
 * choose is monthly or yearly, and nothing about the product changes either way.
 * So this is two cards that differ in one number and a word, with the saving
 * said out loud on the yearly one — computed on the API, because *poupa 17%* is
 * a sentence a page renders rather than a sum it does.
 *
 * **A club that already pays sees the portal, not the cards.** Changing the
 * interval, changing a card, reading a receipt and cancelling are all one page
 * that Stripe hosts and maintains; offering our own switch on top of it would be
 * a second way to do something that already has a better one — and proration is
 * a problem worth not solving twice.
 *
 * **An unpriced interval still appears.** Both are the product, and a page that
 * showed one because the dashboard was half-finished would be a worse lie than
 * *valor por definir*.
 */

const EMPTY: FormState = { ok: false };

const BUTTON =
  'inline-flex items-center justify-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium ' +
  'text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function PlanPicker({
  organizationId,
  intervals,
  currentInterval,
  yearlySavingPercent,
  hasSubscription,
  canManage,
  configured,
  locale,
}: {
  organizationId: string;
  intervals: readonly IntervalOffer[];
  currentInterval: BillingInterval | null;
  yearlySavingPercent: number | null;
  hasSubscription: boolean;
  canManage: boolean;
  configured: boolean;
  locale: string;
}): React.ReactElement {
  const t = useTranslations();
  const [checkout, startCheckout, checkingOut] = useSavedAction(checkoutAction, EMPTY);
  const [portal, openPortal, opening] = useSavedAction(portalAction, EMPTY);

  if (hasSubscription) {
    return (
      <section className="rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('subscription.manage')}
        </h2>
        <p className="mt-2 text-sm text-foreground-muted">{t('subscription.portalExplains')}</p>
        {/*
          Said here rather than offered as a control: switching interval is a
          proration, and Stripe's page already does it correctly.
        */}
        <p className="mt-1 text-sm text-foreground-muted">{t('subscription.switchInterval')}</p>

        <form action={openPortal} className="mt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <button type="submit" disabled={!canManage || opening} className={BUTTON}>
            <ExternalLink aria-hidden className="size-4" />
            {opening ? t('common.working') : t('subscription.openPortal')}
          </button>
        </form>

        <Refusal state={portal} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('subscription.chooseInterval')}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        {intervals.map((offer) => {
          const priced = offer.amountCents !== null;

          return (
            <form
              key={offer.interval}
              action={startCheckout}
              className="flex flex-col rounded border border-border bg-surface p-5"
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="interval" value={offer.interval} />

              <h3 className="font-medium">{t(`subscription.interval.${offer.interval}`)}</h3>

              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {priced ? (
                  <>
                    {formatCents(locale, offer.amountCents!)}
                    <span className="text-sm font-normal text-foreground-muted">
                      {' '}
                      {offer.interval === 'yearly'
                        ? t('marketing.pricing.perYear')
                        : t('marketing.pricing.perMonth')}
                    </span>
                  </>
                ) : (
                  <span className="text-base font-normal text-foreground-muted">
                    {t('marketing.pricing.amountNote')}
                  </span>
                )}
              </p>

              {/*
                The saving appears only where it is a fact: both prices known and
                yearly genuinely cheaper. The API returns null otherwise rather
                than a nought, because "poupa 0%" is worse than silence.
              */}
              {offer.interval === 'yearly' && yearlySavingPercent !== null && (
                <p className="mt-1 text-sm text-primary">
                  {t('subscription.yearlySaving', { percent: yearlySavingPercent })}
                </p>
              )}

              {currentInterval === offer.interval && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-primary">
                  <Check aria-hidden className="size-4" />
                  {t('subscription.currentInterval')}
                </p>
              )}

              <button
                type="submit"
                /*
                  Disabled only where pressing it could not possibly work: no
                  Stripe, no price, or not the owner. The API refuses all three
                  besides — this is the courtesy, not the control.
                */
                disabled={!configured || !priced || !canManage || checkingOut}
                className={`${BUTTON} mt-4 w-full`}
              >
                {checkingOut ? t('common.working') : t('subscription.subscribe')}
              </button>
            </form>
          );
        })}
      </div>

      <Refusal state={checkout} />

      <p className="text-sm text-foreground-muted">{t('subscription.cardHandledByStripe')}</p>
    </section>
  );
}

/**
 * A refusal, beside the thing that was refused.
 *
 * `useSavedAction` raises the toast as well; this is here because a redirect to
 * Stripe that did not happen leaves the reader looking at the button they just
 * pressed, and a message four hundred pixels away at the top of the screen is a
 * message about some other page.
 */
function Refusal({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.ok || state.errorKey === undefined) return null;

  return (
    <p className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      {t(state.errorKey)}
    </p>
  );
}
