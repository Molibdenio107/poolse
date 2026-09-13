'use client';

import { useTranslations } from 'next-intl';
import { Check, ExternalLink } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { formatCents } from '@/lib/money';
import type { PlanKey, PlanOffer } from '@/lib/api';
import { checkoutAction, portalAction } from './subscription.actions';
import type { FormState } from '../actions';

/**
 * The three plans, and the one button that matters — slice 2.4.
 *
 * **A club that already pays sees the portal, not the plans.** Changing a plan,
 * changing a card, reading a receipt and cancelling are all one page that Stripe
 * hosts and maintains; offering our own three cards on top of it would be a
 * second way to do something that already has a better one, and two checkouts
 * against one customer is two charges a month.
 *
 * **A plan with no price still appears.** The three plans are the product, and a
 * page that showed two of them because somebody had not finished the Stripe
 * dashboard would be a worse lie than *valor por definir* — which is what the
 * public pricing page has said since it was written.
 */

const EMPTY: FormState = { ok: false };

const BUTTON =
  'inline-flex items-center justify-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium ' +
  'text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function PlanPicker({
  organizationId,
  plans,
  currentPlan,
  hasSubscription,
  canManage,
  configured,
  locale,
}: {
  organizationId: string;
  plans: readonly PlanOffer[];
  currentPlan: PlanKey | null;
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
        {t('subscription.choosePlan')}
      </h2>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const priced = plan.amountCents !== null;

          return (
            <form
              key={plan.key}
              action={startCheckout}
              className="flex flex-col rounded border border-border bg-surface p-5"
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="plan" value={plan.key} />

              <h3 className="font-medium">{t(`marketing.pricing.${plan.key}.name`)}</h3>
              <p className="mt-1 text-sm text-foreground-muted">
                {t(`marketing.pricing.${plan.key}.who`)}
              </p>

              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {priced ? (
                  <>
                    {formatCents(locale, plan.amountCents!)}
                    {plan.interval !== null && (
                      <span className="text-sm font-normal text-foreground-muted">
                        {' / '}
                        {t(`subscription.interval.${plan.interval}`)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-base font-normal text-foreground-muted">
                    {t('marketing.pricing.amountNote')}
                  </span>
                )}
              </p>

              {currentPlan === plan.key && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-primary">
                  <Check aria-hidden className="size-4" />
                  {t('subscription.currentPlan')}
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
