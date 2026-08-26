'use client';

import { useTranslations } from 'next-intl';
import { applyTheme } from '../../lib/apply-theme';
import { setThemeAction } from './preferences.actions';
import type { Theme } from '../../lib/theme';

const CYCLE: Record<Theme, Theme> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const GLYPH: Record<Theme, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

/**
 * Three states, not two, because `system` is a real answer and the one most
 * people want — a toggle that can only say "light" or "dark" makes following the
 * operating system something you can leave but never return to.
 *
 * It does two things on one click, and both are needed. `applyTheme` changes the
 * page you are looking at, right now; the server action saves the choice against
 * your account so it follows you to another browser. Doing only the second was
 * the bug — the `dark` class lives on `<html>`, above the React tree a server
 * action re-renders, so the colours did not move until a hard refresh.
 */
export function ThemeToggle({ label, theme }: { label: string; theme: Theme }): React.ReactElement {
  const t = useTranslations();
  const next = CYCLE[theme];

  return (
    <form action={setThemeAction}>
      <input type="hidden" name="theme" value={next} />
      <button
        type="submit"
        onClick={() => applyTheme(next)}
        aria-label={`${label}: ${t(`theme.${theme}`)}`}
        title={t(`theme.${theme}`)}
        className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {GLYPH[theme]}
      </button>
    </form>
  );
}
