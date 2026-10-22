'use client';

import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { HOME_PATH, type AppHat } from '@/lib/app-hats';
import { cn } from '@/lib/utils';

/** Where the last-chosen home is remembered, per device — best effort. */
export const HOME_KEY = 'poolse.app.home';

/**
 * The switcher between a person's homes — *As minhas aulas* / *Família* /
 * *Manutenção*, offering only what they hold (POOLSE-90). A row of links, so it
 * works before hydration and each home is its own address. The last one used is
 * remembered on this device (`localStorage`, wrapped: a private window or
 * blocked storage just forgets).
 */
export function AppSwitcher({ homes }: { homes: AppHat[] }): React.ReactElement | null {
  const t = useTranslations();
  const pathname = usePathname();
  const current = homes.find((hat) => pathname.startsWith(HOME_PATH[hat]));

  useEffect(() => {
    if (current === undefined) return;
    try {
      window.localStorage.setItem(HOME_KEY, current);
    } catch {
      // Storage refused: nothing to remember, nothing broken.
    }
  }, [current]);

  if (homes.length < 2) return null;

  return (
    <nav aria-label={t('app.switcher')} className="flex flex-wrap gap-2">
      {homes.map((hat) => (
        <Link
          key={hat}
          href={HOME_PATH[hat]}
          aria-current={hat === current ? 'page' : undefined}
          className={cn(
            'inline-flex h-control items-center justify-center rounded-full border px-4 text-control',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            hat === current ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface',
          )}
        >
          {t(`app.home.${hat}`)}
          <LinkBusy />
        </Link>
      ))}
    </nav>
  );
}

/**
 * On `/app`, with more than one home: go to the one last used on this device,
 * else the first. A client step only because the memory lives in the browser.
 */
export function RememberedHome({ homes }: { homes: AppHat[] }): null {
  useEffect(() => {
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(HOME_KEY);
    } catch {
      remembered = null;
    }
    const hat = homes.find((one) => one === remembered) ?? homes[0];
    if (hat !== undefined) window.location.replace(HOME_PATH[hat]);
  }, [homes]);
  return null;
}
