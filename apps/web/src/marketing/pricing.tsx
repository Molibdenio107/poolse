import Link from 'next/link';
import { translator, type MarketingLocale } from './content';
import { MarketingShell } from './shell';
import { IntervalToggle } from './interval-toggle';

/**
 * Pricing — one plan, two intervals, and the amounts deliberately absent.
 *
 * **Three tiers lasted a day** (POOLSE-60). An organization either pays for
 * Poolse and gets everything or it does not pay and is on a trial; the only
 * axis left is how often they pay. So there is one card, one feature list, and
 * no comparison table — a comparison table exists to help somebody choose
 * between tiers, and there is nothing to choose.
 *
 * **The amounts are still not decided**, and inventing one would put a number in
 * front of a customer that nobody has agreed to honour — the same category of
 * invention as a fake testimonial, and it gets the same treatment: a visible
 * placeholder rather than a plausible lie.
 *
 * **This page cannot read the real prices, and that is not an oversight.** The
 * figures live in Stripe and are fetched by the API, which requires a session;
 * this page is public. When the numbers are settled they arrive here through a
 * small public endpoint, and everything else on this screen stays as it is.
 */

/**
 * The whole product, in one list.
 *
 * Assembled from what the three tiers used to split between them, minus the two
 * that only existed to make a middle tier look thin — `sites1` and `sitesMany`
 * were limits rather than features, and there are no limits by plan any more.
 */
const FEATURES = [
  'sitesUnlimited',
  'studentsMore',
  'classes',
  'staff',
  'billing',
  'maintenance',
  'energy',
  'dashboards',
  'support',
] as const;

export function Pricing({ locale }: { locale: MarketingLocale }): React.ReactElement {
  const t = translator(locale);

  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight">{t('marketing.pricing.title')}</h1>
        <p className="max-w-2xl text-lg text-foreground-muted">
          {t('marketing.pricing.subhead')}
        </p>
        <p className="text-sm text-foreground-muted">{t('marketing.trialNote')}</p>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-16">
        <div className="flex flex-col gap-6 rounded border border-border bg-surface p-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-medium">{t('marketing.pricing.planName')}</h2>
            <p className="text-foreground-muted">{t('marketing.pricing.planWho')}</p>
          </div>

          {/*
            Yearly is selected first — the ticket's own decision, and the one a
            club is being nudged towards. The toggle is the only interactive
            thing on an otherwise static page, so it is the only client
            component.
          */}
          <IntervalToggle
            labels={{
              yearly: t('marketing.pricing.interval.yearly'),
              monthly: t('marketing.pricing.interval.monthly'),
              perYear: t('marketing.pricing.perYear'),
              perMonth: t('marketing.pricing.perMonth'),
              placeholder: t('marketing.pricing.amountPlaceholder'),
              note: t('marketing.pricing.amountNote'),
              yearlyHint: t('marketing.pricing.yearlyHint'),
            }}
          />

          <ul className="flex flex-col gap-2 text-sm">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex gap-2">
                {/*
                  A dash, not a tick icon. Icons are a placeholder decision too,
                  and a bullet that carries no meaning beats one borrowed from an
                  icon set nobody has chosen.
                */}
                <span aria-hidden className="text-foreground-muted">
                  —
                </span>
                <span>{t(`marketing.pricing.features.${feature}`)}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/sign-up"
            className="rounded bg-primary px-4 py-2 text-center text-sm text-primary-foreground"
          >
            {t('marketing.startFree')}
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <div className="rounded border border-border bg-surface-muted p-6">
          <h2 className="mb-2 font-medium">{t('marketing.pricing.questionsTitle')}</h2>
          <p className="text-sm text-foreground-muted">{t('marketing.pricing.questionsBody')}</p>
        </div>
      </section>
    </MarketingShell>
  );
}
