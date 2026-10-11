import type { Metadata } from 'next';
import { ThemeScript } from '../../lib/theme-script';
import '../globals.css';

/**
 * Root layout for the pages anybody may open — POOLSE-71's water page.
 *
 * Like the marketing layouts, and for the same reason: no Clerk, no session, no
 * app shell. A bather scanning a QR at the entrance is not a user of the product
 * and must not be sent to a sign-in screen. The theme comes from the inline
 * script, so a lobby screen in a dark room is dark.
 *
 * `noindex`: the page is reached by a printed link, and a search engine listing
 * a club's water readings is not something the club asked for.
 */
export const metadata: Metadata = {
  title: 'Poolse',
  robots: { index: false, follow: false },
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="pt-PT" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
