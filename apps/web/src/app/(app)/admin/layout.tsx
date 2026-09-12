import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { PreferenceControls } from '../preference-controls';
import { UserMenu } from '../user-menu';

/**
 * The platform operator's shell — `/admin`.
 *
 * **It has to look like somewhere else.** An operator moving between a tenant's
 * screens and the list of every tenant is one misread header away from thinking
 * a number belongs to the club they were just looking at. So: no sidebar, a
 * different bar, and the word Platform next to a mark, always visible.
 *
 * **It is under `(app)` rather than in a route group of its own.** The URL is
 * `/admin` either way — a route group contributes no path segment — and the
 * alternative was a fourth root layout duplicating `ClerkProvider`,
 * `NextIntlClientProvider`, the theme cookie and the toast stack for no
 * difference the operator can see. What it deliberately does *not* inherit is
 * `dashboard/layout.tsx`, which is where the tenant navigation lives.
 *
 * **Nothing links here.** There is no entry in `AppSidebar`, for anybody,
 * including an operator — the way in is to type the address. That is not the
 * control, and it is not pretending to be: `PlatformAdminGuard` on the API is,
 * and the page below redirects anyone the API turns away. Hiding a control is
 * never the control, but an area nobody can stumble into is still worth having.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        Deliberately not the tenant app's bar. That one is `bg-surface` with an
        empty brand slot waiting for a customer's logo; this one is inverted —
        the operator should be able to tell which side they are on from the
        corner of their eye, without reading a word.
      */}
      <header className="sticky top-0 z-20 flex h-app-bar items-center justify-between gap-3 border-b border-border bg-foreground px-6 text-background print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span className="truncate text-sm font-semibold tracking-tight">
            {t('admin.mark')}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/*
            The way back to the tenant app, spelled out. An operator who lands
            here from a bookmark has no navigation at all otherwise, and a page
            whose only exit is the browser's back button is a page people close.
          */}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-background/80 hover:text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('admin.backToApp')}
          </Link>

          {/*
            The same two controls as the tenant bar. Language and theme are the
            person's, not the tenant's — an operator reading in pt-PT here and
            in a club's screen ought not to switch languages at the door.
          */}
          <PreferenceControls />
          <UserMenu />
        </div>
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
