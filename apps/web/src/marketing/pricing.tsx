import Link from 'next/link';
import { translator, type MarketingLocale } from './content';
import { MarketingShell } from './shell';

/**
 * Pricing, with the prices deliberately absent.
 *
 * The plan shapes are real — they are drawn from the modules in
 * `docs/roadmap.md`, so what each tier includes is something the product either
 * does or is going to. The amounts are not decided, and inventing them would put
 * a number in front of a customer that nobody has agreed to honour. That is the
 * same category of invention as a fake testimonial, so it gets the same
 * treatment: a visible placeholder rather than a plausible lie.
 *
 * When the figures are settled, they replace `marketing.pricing.*.amount` in
 * both catalogues and nothing else here changes.
 */
const PLANS = ['starter', 'club', 'network'] as const;

const FEATURES: Record<(typeof PLANS)[number], readonly string[]> = {
  starter: ['sites1', 'students', 'classes', 'staff', 'email'],
  club: ['sitesMany', 'studentsMore', 'billing', 'maintenance', 'priority'],
  network: ['sitesUnlimited', 'energy', 'dashboards', 'sso', 'support'],
};

export function Pricing({ locale }: { locale: MarketingLocale }): React.ReactElement {
  const t = translator(locale);

  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight">{t('marketing.pricing.title')}</h1>
        <p className="max-w-2xl text-lg text-foreground-muted">
          {t('marketing.pricing.subhead')}
        </p>
        <p className="text-sm text-foreground-muted">{t('marketing.trialNote')}</p>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-16 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan}
            className="flex flex-col gap-5 rounded border border-border bg-surface p-6"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-medium">{t(`marketing.pricing.${plan}.name`)}</h2>
              <p className="text-sm text-foreground-muted">
                {t(`marketing.pricing.${plan}.who`)}
              </p>
            </div>

            {/*
              The placeholder is meant to look unfinished. A grey dash reads as
              "not decided yet"; an invented number reads as a commitment.
            */}
            <div className="flex flex-col gap-1">
              <span className="rounded border border-dashed border-border px-3 py-2 text-center text-2xl font-semibold text-foreground-muted">
                {t('marketing.pricing.amountPlaceholder')}
              </span>
              <span className="text-xs text-foreground-muted">
                {t('marketing.pricing.amountNote')}
              </span>
            </div>

            <ul className="flex flex-col gap-2 text-sm">
              {FEATURES[plan].map((feature) => (
                <li key={feature} className="flex gap-2">
                  {/*
                    A dash, not a tick icon. Icons are a placeholder decision too,
                    and a bullet that carries no meaning beats one borrowed from
                    an icon set nobody has chosen.
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
              className="mt-auto rounded bg-primary px-4 py-2 text-center text-sm text-primary-foreground"
            >
              {t('marketing.startFree')}
            </Link>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="rounded border border-border bg-surface-muted p-6">
          <h2 className="mb-2 font-medium">{t('marketing.pricing.questionsTitle')}</h2>
          <p className="text-sm text-foreground-muted">{t('marketing.pricing.questionsBody')}</p>
        </div>
      </section>
    </MarketingShell>
  );
}
