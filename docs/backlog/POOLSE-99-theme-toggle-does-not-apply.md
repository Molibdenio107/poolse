# POOLSE-99 · The theme toggle doesn't change the theme until something else re-renders

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Global / Preferences · **Priority:** High · **Depends on** —

### PO — why this exists

Rui, 22-10-2026: *"When changing theme (clicking on dark/light mode) it doesn't work, but if I change the language it does work."*

### BA — what happens

`ThemeToggle` (`app/(app)/theme-toggle.tsx`) does two things on one click: `applyTheme(next)` flips the `dark` class and **writes the theme cookie in the browser**, then the form posts `setThemeAction`.

In `persist()` (`preferences.actions.ts`), the server decides whether anything changed by comparing the cookie it receives with the requested theme:

```ts
const newTheme = … && store.get(THEME_COOKIE)?.value !== theme;
…
if (newLocale || newTheme) revalidatePath('/', 'layout');
```

The browser already wrote the new cookie before the request went out, so the server sees cookie === theme, concludes nothing changed, and **never revalidates the layout**. The router cache keeps the old `<html className>` from `layout.tsx` (`theme === 'dark' ? 'dark' : undefined`), and the next navigation patches the old class straight back. Changing the language *does* revalidate the layout, which is why that "fixes" it.

Two smaller things in the same control:
- The cycle is **system → light → dark → system**. When the OS is already light, the first click (system → light) changes nothing visible, which also reads as "doesn't work".
- For `system` + dark OS, the server renders `<html>` without `dark`; only the pre-paint script adds it. Any server re-render drops it until the next full load.

### Dev notes

- In `persist()`, treat the theme as changed when the **account's stored value** differs, or simply always revalidate on a theme action (it's a user click, not a loop). Keep the loop guard for `syncPreferencesAction`, which is the one that must not revalidate needlessly.
- Make `layout.tsx` render the resolved class for `system` too, or leave `className` off `<html>` entirely and let the pre-paint script and `applyTheme` own it (then React never fights it). The second is cleaner: one owner of the `dark` class.
- Consider making the toggle show what it will *do* (next state) rather than the current state, or a three-option menu (Sistema / Claro / Escuro), so system → light on a light OS doesn't look like a dead click. Rui to pick, see open question.
- A Playwright spec: click the toggle, assert `html.dark` and the cookie, navigate to another page, assert it is still dark; reload, still dark; then switch language and assert the theme is kept.

### QA — scenarios

1. **Given** light mode, **when** I click the toggle until dark, **then** the page turns dark immediately and stays dark after clicking any menu entry and after a reload.
2. **Given** dark, **when** I switch to Portuguese, **then** it stays dark.
3. **Given** `system` with a dark OS, **when** I save any form, **then** the page does not flash or turn light.
4. On a second browser, signing in picks up the stored theme.

### Acceptance criteria

1. One click changes the theme and it sticks across navigation, reload, language changes and server actions.
2. The spec above passes in both locales.

### Open questions

1. Keep the three-state cycling button, or replace it with a small menu (Sistema / Claro / Escuro)? Recommended: the menu. A cycling button that sometimes does nothing visible will keep being reported as broken.
