'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { applyTheme } from '../../lib/apply-theme';
import { setThemeAction } from './preferences.actions';
import { THEMES, type Theme } from '../../lib/theme';

const ICON: Record<Theme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/**
 * The theme, as a menu of three — POOLSE-99 (Rui, 22-10-2026).
 *
 * It was a button cycling system → light → dark, and on a light operating
 * system the first click (system → light) changed nothing visible, which read
 * as broken. A menu says all three answers at once and the one in force, so
 * no choice is ever a dead click.
 *
 * Three answers, not two, because `system` is a real one and the one most
 * people want — a toggle that can only say "light" or "dark" makes following
 * the operating system something you can leave but never return to.
 *
 * Choosing does two things. `applyTheme` changes the page you are looking at,
 * now; the server action saves the choice against your account so it follows
 * you to another browser, and revalidates the layout so no cached page brings
 * the old theme back. The `dark` class itself is owned by the pre-paint script
 * and `applyTheme` alone — the layout no longer renders it, so a server
 * re-render has nothing to put back.
 */
export function ThemeToggle({ label, theme }: { label: string; theme: Theme }): React.ReactElement {
  const t = useTranslations();
  const [choice, setChoice] = useState<Theme>(theme);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // Another tab or the profile form may have moved it; the server's answer wins.
  useEffect(() => setChoice(theme), [theme]);

  // Closed by Escape and by a click anywhere else, like every menu here.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('click', onClick, true);
    // Focus starts on the answer in force, so Enter keeps it.
    items.current[THEMES.indexOf(choice)]?.focus();
    return () => window.removeEventListener('click', onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `choice` is read on opening only
  }, [open]);

  function choose(next: Theme): void {
    setOpen(false);
    trigger.current?.focus();
    setChoice(next);
    applyTheme(next);
    const form = new FormData();
    form.set('theme', next);
    startTransition(() => setThemeAction(form));
  }

  function onMenuKey(event: React.KeyboardEvent): void {
    const at = items.current.findIndex((item) => item === document.activeElement);
    const move = (to: number): void => {
      event.preventDefault();
      items.current[(to + THEMES.length) % THEMES.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(THEMES.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  }

  const Current = ICON[choice];

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('theme.current', { label, theme: t(`theme.option.${choice}`) })}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border bg-surface text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Current aria-hidden className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-30 mt-1 flex min-w-40 flex-col rounded border border-border bg-surface py-1 shadow-lg"
        >
          {THEMES.map((option, index) => {
            const Icon = ICON[option];
            return (
              <button
                key={option}
                ref={(element) => {
                  items.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={option === choice}
                tabIndex={-1}
                onClick={() => choose(option)}
                className="flex min-h-control items-center gap-2 px-4 text-left text-control text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
              >
                <Icon aria-hidden className="size-4 text-foreground-muted" />
                <span className="flex-1">{t(`theme.option.${option}`)}</span>
                {/* The one in force, by a mark and not only by colour. */}
                <Check aria-hidden className={option === choice ? 'size-4 text-primary' : 'size-4 invisible'} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
