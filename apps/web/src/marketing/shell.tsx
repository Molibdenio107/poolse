import Link from 'next/link';
import { OTHER, translator, type MarketingLocale } from './content';
import { MarketingThemeToggle } from './theme-toggle';

/**
 * Header and footer for the public pages.
 *
 * Deliberately knows nothing about whether anyone is signed in. Asking Clerk
 * would mean reading a session on every request, and these pages are prerendered
 * — so the header offers "sign in" and "start free" to everybody, including the
 * people who are already customers. That is the trade for a landing page that
 * serves instantly from cache, and it is the right way round: the visitor who
 * has never been here is the one this page exists for.
 */
export function MarketingShell({
  locale,
  children,
}: {
  locale: MarketingLocale;
  children: React.ReactNode;
}): React.ReactElement {
  const t = translator(locale);
  const home = locale === 'pt-PT' ? '/' : '/en';
  const pricing = locale === 'pt-PT' ? '/pricing' : '/en/pricing';
  const other = OTHER[locale];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href={home} className="text-lg font-semibold tracking-tight">
            {t('app.name')}
          </Link>

          <nav aria-label={t('nav.label')} className="flex flex-wrap items-center gap-2">
            <Link
              href={pricing}
              className="rounded px-3 py-1.5 text-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            >
              {t('marketing.pricingLink')}
            </Link>
            <Link
              href={other.href}
              hrefLang={other.locale}
              className="rounded px-2.5 py-1.5 text-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            >
              {other.locale === 'en' ? 'EN' : 'PT'}
            </Link>
            {/*
              Labels resolved here, on the server, so the client component does
              not pull both message catalogues into the static bundle.
            */}
            <MarketingThemeToggle
              label={t('theme.toggle')}
              names={{
                system: t('theme.system'),
                light: t('theme.light'),
                dark: t('theme.dark'),
              }}
            />
            <Link
              href="/sign-in"
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              {t('auth.signIn')}
            </Link>
            <Link
              href="/sign-up"
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              {t('marketing.startFree')}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-foreground-muted">
          <span>{t('marketing.footerNote')}</span>
          <Link href={pricing} className="hover:text-foreground">
            {t('marketing.pricingLink')}
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * A marked gap where a screenshot goes once there is a product worth
 * screenshotting.
 *
 * Module 1 does not exist yet, so there is nothing real to show. Inventing a
 * mockup would put a picture of software that does not work in front of someone
 * deciding whether to trust it, which is the kind of shortcut that is very hard
 * to walk back. An honest empty frame costs a little polish and no credibility.
 */
export function ScreenshotSlot({ label }: { label: string }): React.ReactElement {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex min-h-48 items-center justify-center rounded border border-dashed border-border bg-surface-muted p-8 text-center text-sm text-foreground-muted"
    >
      {label}
    </div>
  );
}
