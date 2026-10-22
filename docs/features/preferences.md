# Language and theme

Every signed-in screen's header carries the language switch (PT / EN) and the theme menu.
Both are per person: they are written to a cookie for this browser and to the person's
account, so they follow the person to another device.

## Theme

A menu of three, opened from the header button (POOLSE-99, 22-10-2026): **Sistema**, **Claro**,
**Escuro**. The button shows the choice in force as an icon and names it to a screen reader
("Tema: Escuro"); in the open menu the one in force carries a tick. Arrow keys, Home and End
move through it, Enter chooses, and Escape or a click elsewhere closes it.

- Choosing changes the page at once and saves the choice. It sticks across navigation, a
  reload, a change of language and any form saved afterwards.
- **Sistema** follows the operating system, read by the browser when a page loads.
- On a browser that has never chosen, the account's theme is applied the first time the
  person lands on the dashboard.
- *O meu perfil* sets the same preference with a select.

How it holds: the `dark` class on `<html>` has one owner — the pre-paint script on a load and
`applyTheme` on a choice. The root layout does not render it, so no server re-render or cached
page can put an old theme back. Choosing always revalidates the layout, so the menu and the
browser's theme colour agree with the cookie.

The public marketing pages keep their own cycling button; they have no account to save to.

## Language

Two buttons, PT and EN. Switching re-renders every page in the other language and keeps the
theme.
