import type { Metadata, Viewport } from 'next';
import { enUS, ptPT } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { formats } from '../../i18n';
import { ToastProvider } from '../../components/ui/toast';
import { FormResetGuard } from '../../components/form-reset-guard';
import { BusyIndicator } from '../../components/busy-indicator';
import { readTheme } from '../../lib/preferences';
import { ThemeScript } from '../../lib/theme-script';
import '../globals.css';

/**
 * The tab title and description, in the signed-in person's language. Was a
 * literal "Gestao de piscinas" — Portuguese for everybody, and missing its tilde.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t('app.name'),
    description: t('app.tagline'),
    // Installable — POOLSE-88. `app/manifest.ts`.
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      // iOS reads this, not the manifest's icons.
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    },
    /*
     * The home-screen app on an iPhone. `default` keeps the system's own status
     * bar above the app, legible in both themes; `black-translucent` would draw
     * white clock digits over a white app bar in the light theme.
     */
    appleWebApp: { capable: true, title: 'Poolse', statusBarStyle: 'default' },
  };
}

/** The light and dark surface tokens, for the browser's own chrome. */
const SURFACE = { light: '#FFFFFF', dark: '#141B1F' } as const;

/**
 * The phone's viewport — POOLSE-88.
 *
 * `viewport-fit=cover` lets the page reach under the notch and the home bar,
 * and every shell offset pads itself clear with `--safe-*` (globals.css).
 * **Zoom is never disabled**: pinching is how somebody with poor sight reads a
 * register, and the jump iOS makes on focus is answered by 16px fields instead.
 *
 * The theme colour follows the person's own choice when they made one, and the
 * operating system's otherwise — the cookie is the same one the `<html>` class
 * reads, so the browser bar and the page never disagree.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await readTheme();
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor:
      theme === 'system'
        ? [
            { media: '(prefers-color-scheme: light)', color: SURFACE.light },
            { media: '(prefers-color-scheme: dark)', color: SURFACE.dark },
          ]
        : SURFACE[theme],
  };
}

/**
 * Root layout for everything behind authentication.
 *
 * There are three root layouts in this app now, one per route group, and that is
 * the point of the split: the marketing pages must be statically rendered for
 * speed and search, and this one cannot be. It resolves the locale from the
 * signed-in person, which means reading a cookie, which means every page under
 * it is rendered per request. Sharing a single root layout would have forced
 * that cost onto the landing page too.
 */
const clerkLocalizations: Record<string, typeof ptPT | undefined> = {
  'pt-PT': ptPT,
  en: enUS,
};

function clerkLocalization(locale: string): typeof ptPT {
  return clerkLocalizations[locale] ?? ptPT;
}

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <ClerkProvider localization={clerkLocalization(locale)}>
      {/*
        No `className` here, on purpose — POOLSE-99. The `dark` class has one
        owner: the pre-paint script on a load, and `applyTheme` on a choice.
        When this layout rendered it too, a cached or stale render put the old
        class back on navigation, and `system` on a dark OS lost its class on
        every server re-render, because only the browser knows the OS. React
        never writes an attribute it was never given, so now nothing fights.
      */}
      <html lang={locale} suppressHydrationWarning>
        <head>
          <ThemeScript />
        </head>
        {/*
          Suppressed on the body as well as the html, and for a different
          reason than the theme.

          Browser extensions write their own attributes onto <body> before
          React hydrates -- ColorZilla's `cz-shortcut-listen`, password
          managers, translation add-ons. React compares the server's markup
          against what it finds and reports a mismatch it can do nothing
          about, on a developer's machine only.

          It is noise, and noise on the console is worse than it looks: it
          is the thing a real hydration bug hides behind. This silences the
          body element's own attributes and nothing inside it, so a genuine
          mismatch in the tree is still reported.
        */}
        <body suppressHydrationWarning>
          {/*
            `formats` as well as `messages`.

            A client provider inherits the locale, the current time and the
            timezone from the server, and neither the messages nor the formats —
            so a client component asking for a named format it could see on the
            server threw `MISSING_FORMAT` instead. Both come from `i18n.ts`, so
            the two sides of the boundary cannot describe a date differently.
          */}
          <NextIntlClientProvider messages={messages} formats={formats}>
            {/*
              Inside the intl provider, because a toast is words: it translates
              its own close button and `useSavedAction` hands it an already
              translated sentence. Outside everything else, so one stack serves
              every screen and a message raised from inside a dialog is not
              unmounted with it.
            */}
            <ToastProvider>{children}</ToastProvider>
            {/* A refused save must not untick a box or move a select. */}
            <FormResetGuard />
            {/* Something is happening, bottom right — POOLSE-98. */}
            <BusyIndicator />
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
