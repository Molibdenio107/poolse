import { THEME_COOKIE, type Theme } from './theme';

/**
 * Applies a theme in the browser, immediately.
 *
 * Both toggles call this, and both need it for the same reason: changing the
 * theme has to be visible on the current page, not on the next full load.
 *
 * The signed-in app also posts a server action so the choice is saved against
 * the account and follows the person to another device — but a server action
 * re-renders the React tree, and the `dark` class lives on `<html>`, which sits
 * above that tree. Waiting for the server was the bug: the cookie changed, the
 * page re-rendered, and the colours stayed exactly as they were until somebody
 * pressed refresh.
 *
 * The marketing pages have no server round trip at all, by design, so for them
 * this is the whole mechanism.
 */
export function applyTheme(next: Theme): void {
  const dark =
    next === 'dark' ||
    (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  // Read back by the toggles to know which state to show, and by the pre-paint
  // script on the next load.
  root.setAttribute('data-theme-preference', next);

  // A year, matching the server-side options in preferences.ts. Deliberately not
  // httpOnly — see the note on themeCookieOptions there.
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/** What the pre-paint script decided, so a toggle can show the right glyph. */
export function currentTheme(): Theme {
  const applied = document.documentElement.getAttribute('data-theme-preference');
  return applied === 'light' || applied === 'dark' ? applied : 'system';
}
