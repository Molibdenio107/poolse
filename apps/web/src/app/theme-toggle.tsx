'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'poolse-theme';

export function ThemeToggle({ label }: { label: string }): React.ReactElement {
  const [isDark, setIsDark] = useState(false);

  // The inline script in layout.tsx has already applied the class by now; this
  // only syncs component state to what the document is actually showing.
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle(): void {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Private browsing, or storage disabled. The toggle still works for this
      // session; it just will not be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={isDark}
      className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {isDark ? '☾' : '☀'}
    </button>
  );
}
