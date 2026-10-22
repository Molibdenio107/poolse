'use client';

import { useEffect, useRef } from 'react';
import { applyTheme } from '../../../lib/apply-theme';
import { isTheme } from '../../../lib/theme';
import { syncPreferencesAction } from '../preferences.actions';

/**
 * Copies the stored preference into this browser's cookies, once, when they
 * disagree.
 *
 * The cookie is per-browser and `app_user.locale` is per-person, so on a new
 * device the cookie is simply absent and the page renders in the default
 * language. Without this the choice someone made months ago on their laptop
 * would never reach their phone.
 *
 * Mounted on the dashboard because that is where people land after signing in —
 * the first render of a new session is one language late, and the one after it is
 * right. Paying an API call on every request to avoid that lag is the wrong
 * trade; this runs once per browser, then never fires again.
 *
 * Renders nothing.
 */
export function PreferenceSync({
  storedLocale,
  storedTheme,
  activeLocale,
  activeTheme,
}: {
  storedLocale: string;
  storedTheme: string;
  activeLocale: string;
  activeTheme: string;
}): null {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (storedLocale === activeLocale && storedTheme === activeTheme) return;

    // Guarded rather than relying on the dependency list: the action revalidates
    // the layout, which re-renders this component, which would otherwise line up
    // a second call against the freshly-written cookies.
    attempted.current = true;
    // The layout no longer renders the `dark` class (POOLSE-99), so the stored
    // theme is put on this page here, after the server has seeded the cookie
    // and revalidated — the menu then reads the same answer.
    const theme = storedTheme !== activeTheme && isTheme(storedTheme) ? storedTheme : null;
    void syncPreferencesAction(storedLocale, storedTheme).finally(() => {
      if (theme !== null) applyTheme(theme);
    });
  }, [storedLocale, storedTheme, activeLocale, activeTheme]);

  return null;
}
