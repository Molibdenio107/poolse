---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/app/globals.css"
  - "apps/web/tailwind.config.ts"
  - "apps/web/src/lib/{nav-entries,attention-items,archive-trigger,form-pdf}.ts"
---

# Interface

Read [`docs/conventions/interface.md`](docs/conventions/interface.md) before touching any screen: look, forms, dialogs, navigation, the phone, the app shell, the dashboard.

- The dashboard is a union of role bands, and a widget is one declaration in a registry.
- Owner and Admin land on *Início* (`/dashboard/welcome`); the page sign-in lands on never server-redirects, it hands on with `LandOn` (Rui, 10-11-2026).
- A page with nothing to work on yet (no pool, no turma) shows `NothingYet` (`components/nothing-yet.tsx`) and the next step, never an empty grid or a form that governs nothing (Rui, 10-11-2026).
- A save says so, and it says so once: a success is the centred pulse (`SavedPulse` in `components/ui/toast.tsx`); a refusal, a warning or a success with a button is a toast (Rui, 10-11-2026).
- A section that opens and closes moves smoothly
- Something slow says so in the corner, and the signal comes from where the work starts.
- The look is tokens, from the design handoff
- Every button and every form control is one size: `h-control` (36px) and `text-control` (15px).
- On a phone the same tokens take a second value, and the shell clears the notch.
- Form fields are controlled, never `defaultValue`.
- A circle means something needs doing, and it clears when it is done
- A number on a tab, pill or menu entry means "things to do", never "things here": `AttentionMark` (dot for 1, breathing number from 2); plain counts are gone (POOLSE-215).
- A circle follows the problem down — menu, tab (`badge: { kind: 'dot' }`), pill (`attention`) — and the card holding it is `attentionClass(n)` until solved: one alone boxed, two or more in a list an accent bar (POOLSE-214, -216).
- The bell lists the circles' own counts (`attentionLines` in `lib/attention-items.ts`); a new badge key needs a line there or typecheck fails. Every line opens where its problem is listed, and site work and lessons are named one line each.
- The menu's entries live in `lib/nav-entries.ts`
- A file is dropped anywhere on the page: `PageDrop` (`components/page-drop.tsx`) hands it to the page's one upload that accepts it, or asks *Onde guardar?* when there are several; an upload names itself with `data-drop-label`, opts out with `data-drop-off`, and always asks with `data-drop-ask` (ID photos).
- A document on paper is a route with print styles; the one PDF library is `lib/form-pdf.ts`, for a club's forms on the phone
- A decision asks first
- An *Arquivar* is quiet (`ARCHIVE_TRIGGER` in `lib/archive-trigger.ts`) and always asks before it archives (Rui, 07-11-2026).
- A question asked in the middle of the page uses `components/ui/dialog.tsx`.
- A dropdown whose options come from data is `SelectList` / `ListSelect` (`components/ui/list-select.tsx`), never a bare `<select>`; `SelectField` switches itself past `LONG_LIST` options (Rui, 12-11-2026).
- A refusal that needs numbers carries them as structure, never as prose.
- Light and dark mode in every app
- Palette: desktop primary `rgb(103, 166, 182)`, complementary `rgb(179, 212, 157)`; text reads an ink, fills read the token.
- Voltar goes back to where you came from, and every in-app link is a `FromLink`.
- A record's page uses `DetailPage`; one card is one tab, and the first is General.
- A page or tab that stacks independent sections shows one at a time, behind `SectionPills`.
- A section of settings too long to scroll is `FoldCard`s (`components/fold-card.tsx`): folded, each says its current value in words.
- One content width, and the calendar is the single exception.
- A fetch that answers `null` for both "not yet" and "it failed" produces a control that is disabled with no explanation.
- A side sheet fits the window; the one growable thing inside it takes the slack.
- Eight level tints, measured in both themes, and always shown at full strength somewhere.
- A page that fails unexpectedly lands in `dashboard/error.tsx`
- A toast in the family app on a phone is a solid full-width bar above the tab bar (`.toast-card`); the backoffice keeps its quiet toast; a success is the pulse in both (Rui, 06-11 and 10-11-2026).
- A typed cost or purchase is *Faturado* only with a document number; without one it is *Estimado* (Rui, 06-11-2026).
- A time a family types is `self_reported`: it may be a best, never official or for mínimos. Distance swum is added up from the times, never typed (Rui, 06-11-2026).
- The family app says the least it can (Rui, 06-11-2026): short labels, *Voltar* with the destination for screen readers only, icons with names for a screen reader, no sentence that repeats a control.
- The family app is soft on a phone
