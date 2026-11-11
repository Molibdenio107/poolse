'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, ChevronRight } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { attentionLines, type AttentionLesson, type AttentionPlace } from '@/lib/attention-items';
import { formatDate } from '@/lib/date-format';
import type { Badges } from '@/lib/nav-entries';
import { cn } from '@/lib/utils';

/** Ctrl+K's *Notificações* opens the bell through this event (POOLSE-212). */
export const OPEN_NOTIFICATIONS = 'poolse:open-notifications';

/**
 * The bell beside the search — POOLSE-212 (Rui, 10-11-2026): what needs doing,
 * one line per kind, each opening the page where its dot breathes.
 *
 * **One source.** The lines are the menu's own counts (`attentionLines` over the
 * badges the layout already has from `/shell`): no request of its own, and the
 * same "needs doing" the dots mean. **No mark-as-read:** a line goes when the
 * thing is solved, on its page or after following the bell, on the next read.
 *
 * A disclosure, not a menu: a button that shows a short list of links, closed by
 * Escape, by a click outside, or by following a link. With anything listed the
 * icon carries the breathing dot; never a red number, never a sound.
 */
export function NotificationBell({
  badges,
  place = 'backoffice',
  places = [],
  lessons = [],
}: {
  badges: Badges;
  place?: 'backoffice' | 'app';
  /** What the site circles are, named — one line each instead of "coisas nas instalações". */
  places?: readonly AttentionPlace[];
  /** The lessons with answers or requests, named — each line opens its lesson. */
  lessons?: readonly AttentionLesson[];
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const lines = attentionLines(badges, place, places, lessons);
  const total = lines.reduce((sum, line) => sum + line.count, 0);

  // Following a line closes it.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const show = (): void => {
      setOpen(true);
      button.current?.focus();
    };
    window.addEventListener(OPEN_NOTIFICATIONS, show);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="relative inline-flex h-control w-control items-center justify-center rounded-sm bg-surface text-foreground-muted shadow-card hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Bell aria-hidden className="size-4" />
        <span className="sr-only">
          {total > 0 ? t('notifications.openWith', { count: total }) : t('notifications.open')}
        </span>
        {/* The dot, a number from two (POOLSE-215). */}
        {total === 1 && <span aria-hidden className="attention-dot absolute right-1.5 top-1.5" />}
        {total > 1 && (
          <span aria-hidden className="attention-count absolute -right-1.5 -top-1.5">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          // On a phone the bell sits left of centre, so the list spans the screen under the bar.
          className="z-30 rounded bg-surface p-2 shadow-card max-md:fixed max-md:inset-x-4 max-md:top-app-bar max-md:mt-2 md:absolute md:right-0 md:top-full md:mt-2 md:w-[22rem]"
        >
          <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('notifications.title')}
          </p>
          {lines.length === 0 ? (
            <p className="px-2 py-3 text-sm text-foreground-muted">{t('notifications.nothing')}</p>
          ) : (
            <ul className="flex flex-col">
              {lines.map((line) => (
                <li key={line.id}>
                  <FromLink
                    href={line.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex min-h-[44px] items-center justify-between gap-3 rounded-sm px-2 py-2 text-sm',
                      'hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="attention-dot" />
                      {t(line.key, { count: line.count, name: line.name ?? '', date: formatDate(line.date), time: line.time ?? '' })}
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-foreground-muted" />
                  </FromLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
