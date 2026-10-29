# POOLSE-118 · A command palette: go anywhere, do the common thing, from the keyboard

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Navigation · **Priority:** Medium (before POOLSE-119) · **Depends on** [POOLSE-87](./POOLSE-87-modules-per-club.md) (module filter), [POOLSE-91](./POOLSE-91-back-goes-back.md) (`FromLink`) · **Related** [POOLSE-119](./POOLSE-119-in-app-assistant.md) (what this is the cheap half of)

### PO — why this exists

Rui, 28-10-2026, asked whether a RAG assistant should help users navigate the desktop app. Agreed: navigation is not where an assistant earns its place — a club's 10–30 staff learn the menu in a week, and the questions an assistant would answer are asked twice and never again. The cheap thing that helps everybody, every day, is a palette: **Ctrl+K, type *quotas*, land on Em dívida**. It also serves as the deep-link target an assistant (POOLSE-119) would answer with, so it is built first.

**Not in scope:** searching records (students, turmas, invoices) from the palette — a second slice, once the page list proves itself; natural-language questions (POOLSE-119); a palette in app mode (`/app`), whose users have four screens and a bottom bar.

### BA — rules

1. **One list, the sidebar's.** The palette reads the same entries `app-sidebar.tsx` draws — `href`, `key`, `roles`, `kinds`, `module`, `unlessRoles` — filtered exactly as the sidebar filters them. A page the reader cannot open is not offered: the sidebar's rule (a menu entry is shown only to the roles its page's API answers, 15-10-2026) is the palette's rule, through the same function, never a second list.
2. **Entries are pages first; a short list of actions second.** Actions are the few things people do daily that otherwise take three clicks: *Registar presenças* (today's next lesson of mine), *Nova aluna/aluno*, *Importar* (opens the page whose importer matches the word), *Mudar tema*, *Mudar idioma*. An action is a declaration — label key, roles, `module`, and either an `href` or a client handler — in one registry (`lib/commands.ts`), the dashboard widget-registry shape.
3. **Matching is accent- and case-folded, on the translated label and a synonym list per entry**, in the reader's language: *quotas*, *em dívida*, *dívidas* all reach Em dívida; *registo*, *presenças*, *chamada* reach the register. The synonym list lives beside the entry (`synonyms: { 'pt-PT': [...], en: [...] }`), not in the message catalogue — `pnpm i18n:check` must not demand an `en` synonym for every Portuguese one.
4. **Opens on Ctrl+K / ⌘K anywhere under `(app)` with a desk layout**, and from a search button in the app bar (so a mouse finds it). Below `md` the button opens the same dialog; the shortcut is not advertised there.
5. **Recent first, then the rest.** The last 5 chosen entries lead the empty list, kept in `localStorage` under a try/catch — a convenience, never a record.
6. **Navigation goes through `FromLink`'s stamping** so *Voltar* still goes back to where the reader was.

### Dev notes

- **UI.** `components/command-palette.tsx`, built on `components/ui/dialog.tsx` (never a second dialog system); a list with roving focus, Enter opens, Escape closes, the dialog's own focus trap. shadcn's `Command` (cmdk) is acceptable if it is wrapped in our `Dialog`; it is not currently a dependency, so either way say in the PR which was chosen and why in one line. `h-control` for the input; icons from the sidebar's own set.
- **Entries.** Factor the sidebar's entry list into `lib/nav-entries.ts` with its filter function, imported by both the sidebar and the palette — this is the one refactor the ticket needs and it is the reason the ticket is cheap. Proposed as such; if Rui says no, the palette imports the array from the sidebar and nothing moves.
- **i18n.** Labels are the sidebar's existing keys; new keys only for the actions and the dialog's own words (`palette.*`).
- **Most likely to be got wrong:** offering a page that then answers 403 — the filter must be the sidebar's, including `module` and `kinds`. Second: a global keydown listener that swallows Ctrl+K inside a text field where the browser's own behaviour matters; register on the window, ignore when a dialog is already open.

### QA — scenarios

1. **Given** an owner on the dashboard, **when** Ctrl+K and *quot*, **then** Em dívida is first; Enter lands there with `?from=` set and *Voltar* returning to the dashboard.
2. **Given** a maintenance login, **then** no student page is offered; **given** a club with `incidents` off, **then** Incidentes is absent.
3. **Given** `en`, **then** *overdue* matches Em dívida and *quotas* does not.
4. **Given** a student record page with a half-typed form, **when** the palette opens and an entry is chosen, **then** `DetailTabs`' discard warning still asks.
5. **Given** the palette open, **then** Escape closes it and focus returns to where it was; Tab stays inside.
6. **Given** `localStorage` throwing, **then** the palette opens with no recents and no error.
7. pt-PT and en, light and dark, keyboard only, and the phone projects prove the app-bar button opens it.

### Acceptance criteria

1. Ctrl+K / ⌘K opens a palette listing every sidebar page the reader may open, filtered by the sidebar's own rule, and nothing it may not.
2. Matching is folded and synonym-aware in both languages; Enter navigates through the `from` mechanism.
3. A handful of daily actions sit in one registry; a new one is a declaration.
4. Keyboard-complete, portalled, themed; no page answers 403 from a palette choice (proved in the role probe for any new endpoint, and by a web test over the filter).
