import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type SubscriptionView } from '@/lib/api';
import { PageError, PageShell } from '@/components/page-shell';
import { PlanPicker } from './plan-picker';

/**
 * What the club pays Poolse — slice 2.4.
 *
 * The one screen in the product whose subject is the bill *we* send. Everything
 * else in phase 2 is money moving between a club and its families.
 *
 * **Under O meu perfil, and owner-only** — narrowed on 13 September 2026. The
 * card, the renewal date and the decision to cancel are the owner's own, so this
 * sits with the account rather than in the menu of the club's work, and the
 * endpoint refuses everybody else regardless of how they arrived.
 *
 * **It says where the club stands before it offers anything.** A trial with four
 * days left, a card that was refused, a subscription set to stop at the end of
 * the month — each of those is a different sentence and a different thing to do,
 * and a page that led with three price cards would be selling to somebody who
 * came to find out whether they were already paying.
 *
 * **Billing state is not access state.** Past due says the card failed; it does
 * not say the club is shut, and nothing here shuts it. Only `suspended_at` does
 * that, it is an operator's decision, and a suspended club never reaches this
 * page — it sees the notice instead.
 */
export default async function SubscriptionPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();

  let view: SubscriptionView | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    view = await apiFetch<SubscriptionView>('/subscription');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  const day = (value: string): string => format.dateTime(new Date(value), 'long');

  return (
    <PageShell title={t('subscription.title')} subtitle={t('subscription.subtitle')}>
      {notPermitted && <PageError message={t('subscription.notPermitted')} />}
      {failure !== null && <PageError message={t(failure.key)} detail={failure.detail} />}

      {view !== null && (
        <>
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('subscription.whereYouStand')}
            </h2>

            <p className="mt-2 text-lg font-medium">
              {view.subscription.status === null
                ? t('subscription.state.unknown')
                : t(`subscription.state.${view.subscription.status}`)}
              {view.subscription.plan !== null && (
                <span className="text-foreground-muted">
                  {' · '}
                  {t(`marketing.pricing.${view.subscription.plan}.name`)}
                </span>
              )}
            </p>

            <dl className="mt-3 space-y-1 text-sm">
              {view.subscription.status === 'trialing' && view.subscription.trialEndsAt !== null && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-foreground-muted">{t('subscription.trialEnds')}:</dt>
                  <dd>{day(view.subscription.trialEndsAt)}</dd>
                </div>
              )}

              {view.subscription.currentPeriodEnd !== null && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-foreground-muted">
                    {view.subscription.cancelAtPeriodEnd
                      ? t('subscription.endsOn')
                      : t('subscription.renewsOn')}
                    :
                  </dt>
                  <dd>{day(view.subscription.currentPeriodEnd)}</dd>
                </div>
              )}
            </dl>

            {/*
              * Each state says the one thing to do about it, in the state's own
              * words. A generic "manage your subscription" would be true of all
              * five and useful in none.
              */}
            {view.subscription.status === 'past_due' && (
              <p className="mt-3 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
                {t('subscription.pastDueExplains')}
              </p>
            )}

            {view.subscription.cancelAtPeriodEnd && (
              <p className="mt-3 rounded border border-border bg-surface-muted p-3 text-sm">
                {t('subscription.cancellingExplains')}
              </p>
            )}

            {view.subscription.status === 'comped' && (
              <p className="mt-3 rounded border border-border bg-surface-muted p-3 text-sm">
                {t('subscription.compedExplains')}
              </p>
            )}
          </section>

          {/*
            * Said plainly rather than by hiding the buttons: an installation with
            * no Stripe key cannot take money, and a page that simply offered
            * nothing would read as a bug.
            */}
          {!view.configured && (
            <section className="rounded border border-border bg-surface-muted p-5 text-sm">
              <p className="font-medium">{t('subscription.notConfiguredTitle')}</p>
              <p className="mt-1 text-foreground-muted">{t('subscription.notConfigured')}</p>
            </section>
          )}

          <PlanPicker
            organizationId={view.subscription.organizationId}
            plans={view.plans}
            currentPlan={view.subscription.plan}
            hasSubscription={view.subscription.hasSubscription}
            canManage={view.canManage}
            configured={view.configured}
            locale={locale}
          />

          {!view.canManage && (
            <p className="text-sm text-foreground-muted">{t('subscription.ownerOnlyHint')}</p>
          )}
        </>
      )}
    </PageShell>
  );
}
