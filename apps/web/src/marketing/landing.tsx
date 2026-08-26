import Link from 'next/link';
import { translator, type MarketingLocale } from './content';
import { MarketingShell, ScreenshotSlot } from './shell';

/**
 * The landing page, for both locales.
 *
 * The copy makes one promise the product can currently keep — sites, pools,
 * staff and their permissions — and is explicit that the rest is coming. There
 * are no customer names, no logos, no counts of pools managed and no
 * testimonials, because none of those exist and a landing page that invents them
 * is a landing page that has to be quietly rewritten later.
 */
const AVAILABLE_NOW = ['facilities', 'people', 'roles', 'languages'] as const;
const COMING = ['classes', 'attendance', 'billing', 'maintenance', 'energy'] as const;

export function Landing({ locale }: { locale: MarketingLocale }): React.ReactElement {
  const t = translator(locale);

  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-20">
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          {t('marketing.headline')}
        </h1>
        <p className="max-w-2xl text-lg text-foreground-muted">{t('marketing.subhead')}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/sign-up"
            className="rounded bg-primary px-5 py-2.5 text-primary-foreground"
          >
            {t('marketing.startFree')}
          </Link>
          <Link
            href={locale === 'pt-PT' ? '/pricing' : '/en/pricing'}
            className="rounded border border-border px-5 py-2.5 hover:bg-surface-muted"
          >
            {t('marketing.seePricing')}
          </Link>
        </div>
        <p className="text-sm text-foreground-muted">{t('marketing.trialNote')}</p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <ScreenshotSlot label={t('marketing.screenshotPlaceholder')} />
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 sm:grid-cols-2">
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('marketing.availableNow')}
            </h2>
            <ul className="flex flex-col gap-3">
              {AVAILABLE_NOW.map((item) => (
                <li key={item} className="flex flex-col gap-0.5">
                  <span className="font-medium">{t(`marketing.now.${item}.title`)}</span>
                  <span className="text-sm text-foreground-muted">
                    {t(`marketing.now.${item}.body`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('marketing.comingLater')}
            </h2>
            <ul className="flex flex-col gap-3">
              {COMING.map((item) => (
                <li key={item} className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground-muted">
                    {t(`marketing.soon.${item}.title`)}
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {t(`marketing.soon.${item}.body`)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-foreground-muted">{t('marketing.comingNote')}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">{t('marketing.ctaTitle')}</h2>
        <p className="max-w-2xl text-foreground-muted">{t('marketing.ctaBody')}</p>
        <Link href="/sign-up" className="rounded bg-primary px-5 py-2.5 text-primary-foreground">
          {t('marketing.startFree')}
        </Link>
      </section>
    </MarketingShell>
  );
}
