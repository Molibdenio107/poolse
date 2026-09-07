import type { Metadata } from 'next';
import { enUS, ptPT } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { formats } from '../../i18n';
import { ToastProvider } from '../../components/ui/toast';
import { readTheme } from '../../lib/preferences';
import { ThemeScript } from '../../lib/theme-script';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Poolse',
  description: 'Gestao de piscinas',
};

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
  const theme = await readTheme();

  return (
    <ClerkProvider localization={clerkLocalization(locale)}>
      {/*
        This layout is force-dynamic, so unlike the marketing pages it can read
        the cookie and put the class in the markup — which means a fresh load is
        correct before a single line of script runs. The script still ships, for
        `system`: only the browser knows what the operating system is set to.
      */}
      <html
        lang={locale}
        className={theme === 'dark' ? 'dark' : undefined}
        data-theme-preference={theme}
        suppressHydrationWarning
      >
        <head>{theme === 'system' && <ThemeScript />}</head>
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
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
