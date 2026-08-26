import type { Metadata } from 'next';
import { enUS, ptPT } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
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
        <body>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
