'use client';

import { useEffect, useState } from 'react';
import { applyTheme, currentTheme } from '../lib/apply-theme';

const CYCLE = { system: 'light', light: 'dark', dark: 'system' } as const;
const GLYPH = { system: '◐', light: '☀', dark: '☾' } as const;

type Theme = keyof typeof CYCLE;

/**
 * The theme control for the public pages.
 *
 * Deliberately not the same component as the app's toggle, even though they look
 * identical. That one is a form that posts a server action: it writes the cookie
 * *and* saves the choice against your account, so it follows you to another
 * device. It also costs a round trip and a re-render, which is fine behind a
 * login and fatal on a page whose whole point is being prerendered.
 *
 * This one writes the cookie from the browser and toggles the class immediately.
 * No request, no rerender, no session — the marketing pages stay static. The same
 * cookie is what the app reads on the server, so a visitor who picks dark here
 * and then signs up finds the app already dark.
 *
 * Labels arrive as props rather than being looked up here, so the client bundle
 * does not have to carry both message catalogues for the sake of three words.
 */
export function MarketingThemeToggle({
  label,
  names,
}: {
  label: string;
  names: Record<Theme, string>;
}): React.ReactElement {
  // Null until mounted: the prerendered HTML cannot know which theme the inline
  // script applied, so the first render is a fixed neutral glyph and the real one
  // arrives on hydration. Guessing here would be a hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function apply(next: Theme): void {
    applyTheme(next);
    setTheme(next);
  }

  const shown: Theme = theme ?? 'system';

  return (
    <button
      type="button"
      onClick={() => apply(CYCLE[shown])}
      aria-label={`${label}: ${names[shown]}`}
      title={names[shown]}
      className="rounded border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {GLYPH[shown]}
    </button>
  );
}
