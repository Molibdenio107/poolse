import Link from 'next/link';
import { translator, type MarketingLocale } from './content';
import { MarketingShell, ScreenshotSlot } from './shell';

/**
 * The landing page, for both locales.
 *
 * It lists what the product does today and is explicit about what it does not
 * yet. The invoices are internal records and not certified faturas, and the
 * page says so in that line. There are no customer names, no logos, no counts
 * of pools managed and no testimonials, because none of those exist, and a
 * landing page that invents them has to be quietly rewritten later.
 *
 * Updated 12-10-2026: the old copy still called classes, billing, maintenance
 * and energy "coming". All four have been built for weeks.
 */
const AVAILABLE_NOW = [
  'facilities',
  'classes',
  'students',
  'billing',
  'reception',
  'water',
  'energy',
  'staff',
  'safety',
  'families',
  'imports',
  'undo',
  'support',
  'languages',
] as const;
const COMING = ['studentApp', 'certified', 'preRegistration'] as const;

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
        <div className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16">
          <div className="flex flex-col gap-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('marketing.availableNow')}
            </h2>
            <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
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
            <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
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
