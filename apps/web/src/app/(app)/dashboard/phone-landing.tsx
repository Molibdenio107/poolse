'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** Tailwind's `md`, where the app's own layouts stop being a phone's. */
const WIDE = '(min-width: 768px)';

/** A parceria's lesson has no phone screen of its own (`lessonHref`), so it stays. */
const STAYS = /^\/dashboard\/calendar\/sessions\//;

/**
 * A teacher's phone is the app, and the back office is for a computer (Rui,
 * 07-11-2026). In the layout, so every way in is covered: sign-in, the site's
 * *Entrar*, a bookmark, a link somebody sent. Width decides, in the browser,
 * because the server cannot see it. This is a door and not a permission: the API
 * answers a teacher the same on any screen.
 *
 * The cover is plain CSS, painted before any script, so a phone never flashes the
 * back office on the way past.
 */
export function PhoneLanding(): React.ReactElement | null {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [wide, setWide] = useState(false);
  const stays = STAYS.test(pathname);

  useEffect(() => {
    if (stays) return;
    if (window.matchMedia(WIDE).matches) {
      setWide(true);
      return;
    }
    router.replace('/app');
    // Never stuck on the cover (Rui, 07-11-2026): if the app's page has not
    // arrived by the router, the browser loads it outright.
    const fallback = window.setTimeout(() => window.location.replace('/app'), 3000);
    return () => window.clearTimeout(fallback);
  }, [stays, pathname, router]);

  if (stays || wide) return null;
  return (
    <div
      role="status"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background text-sm text-foreground-muted md:hidden"
    >
      {t('common.working')}
    </div>
  );
}
