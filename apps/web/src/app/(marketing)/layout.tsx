import type { Metadata } from 'next';
import { ThemeScript } from '../../lib/theme-script';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Poolse — Gestão de piscinas',
  description:
    'Software para quem gere piscinas: instalações, tanques, equipa e permissões. Teste 14 dias sem cartão.',
};

/**
 * Root layout for the Portuguese marketing pages.
 *
 * Its whole job is to be static. No Clerk, no cookies, no session — those are
 * what would force this page to be rendered per request, and the landing page is
 * the one screen where time-to-first-paint is the product. The theme is applied
 * by a tiny inline script instead, so dark mode still works without giving that
 * up.
 *
 * The English pages live under a second root layout so that `lang` is right in
 * the markup a crawler reads, which a nested layout cannot change.
 */
export default function MarketingLayout({
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
