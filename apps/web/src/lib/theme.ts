/**
 * The theme vocabulary, and nothing else.
 *
 * Deliberately free of `next/headers` and every other server-only import, so
 * that both halves of the app can use it: `preferences.ts` reads the cookie on
 * the server, `apply-theme.ts` writes it in the browser, and neither drags the
 * other's dependencies along. Putting these three lines in `preferences.ts` was
 * enough to pull `next/headers` into a client bundle and break the build.
 */
export const THEME_COOKIE = 'poolse-theme';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const defaultTheme: Theme = 'system';

export function isTheme(value: string | undefined): value is Theme {
  return (THEMES as readonly string[]).includes(value ?? '');
}
