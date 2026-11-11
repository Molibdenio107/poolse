# POOLSE-219 · A file dropped anywhere in the backoffice is asked *O que é isto?* and handed to the screen that already reads it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** App shell / Importers / Files · **Priority:** Low (post go-live) · **Depends on** POOLSE-57 (`FileDrop`), POOLSE-118 (Ctrl+K), POOLSE-137 (AI gates, untouched here) · **Unblocks** POOLSE-220, POOLSE-221, POOLSE-222

### PO — why this exists

Rui, 11-11-2026: *"allow the user to anywhere on the app, simply drag and drop an file, either pdf , excel etc, and then Poolse reads it and knows what and where to import. For example, im in the main 'dashboard' simply drag a excel file containg students and it imports the student list (or redirects to the student import functiality, such as review columns etc)"*. And: *"A 'what's this' picker is good idea."* *"the main functionality would be for a list of students and perhaps a calendar or parcerias and turmas."* *"this would also have to work for pictures, such as instalações picures, logo or a pool picture"*. *"This would be good for after post live for pilot of course."*

Every importer already takes a file dropped on its own page, and a water report dropped on any water section already travels to Laboratório (`lib/pending-file.ts`). What is missing is the same gesture on a page that has no importer. This ticket builds the whole gesture **with no model call**: the shell catches the file, a spreadsheet is recognised by its headings with the matchers that exist, everything else is asked, and the file is handed to the screen that reads it. It costs nothing to run and is the frame the three AI tickets plug into.

**Decided (Rui, 11-11-2026):** a drop never writes anything. It always ends on the destination's own review step or upload control, where a person confirms.

**Not in scope:** any model call (POOLSE-220); finding whose paper a PDF is (POOLSE-221, -222); a turmas importer (there is none: the timetable import writes `evento` bookings, see **Open** 1); several files in one drop; the family app and the phone (no drag and drop there); a new importer or a new upload route of any kind.

### BA — rules

1. In the backoffice shell (never `/app`, never `/admin`, never a public page), dragging **files** over a page that has no drop target of its own shows the full-page overlay, and dropping opens the dialog *O que é isto?*.
2. A page's own target wins. Where an importer's `FileDrop` or a `drop-target.tsx` box is mounted, the shell does nothing, and the file goes where it goes today.
3. Only a drag that carries files counts (`carriesFiles`). A calendar block, a mapped column or selected text never raises the overlay.
4. One file a drop. Two or more are refused with a sentence, and nothing is read.
5. The type is judged by the file's first bytes, never its name: a spreadsheet (xlsx, xls, csv), a PDF, an image (JPEG, PNG, WebP, HEIC), or a LENEX results file. Anything else, a macro workbook (.xlsm) included, is refused with a sentence. 10 MB at most.
6. **A spreadsheet** is read as the importers read it (`readSheet`, on the Next server, stored nowhere) and its headings are scored against every `MatchSpec` the reader's role may use. One clear winner is preselected in the dialog; a tie or a weak score preselects nothing. No model is called, whatever the gates say.
7. **A PDF** opens the dialog with nothing preselected (until POOLSE-220).
8. **An image** opens the dialog offering *Fotografia da instalação*, *Fotografia de uma piscina*, *Logótipo do clube*, *Fotografia de uma pessoa* and *Documento de uma pessoa*. On a site's page the site is preselected, on a tank's page the tank, on a person's page the person.
9. **A LENEX file** preselects *Resultados de prova*.
10. The dialog lists only destinations the reader's role may use, taken from the same source the menu uses. A destination whose module is switched off for the club is not listed.
11. A destination that needs a subject asks for it in the dialog: which site, which tank, which person (the existing person search). A destination that is a person's is reached only through that person's own page and its own upload control, so consent, sealing and audit are that control's and are not restated.
12. *Continuar* holds the file (`holdFile`) and navigates; the destination takes it once (`takeFile`) and starts at the step where a file has just been chosen. *Cancelar* drops it. A full reload loses it, which only means dropping it again.
13. A file Poolse cannot place closes with *"O Poolse não sabe onde guardar este ficheiro"* and the list of what it does take. Nothing is kept.
14. Ctrl+K gains the action *Importar um ficheiro*, which opens the same dialog with a file chooser, so the feature does not depend on a mouse.

**Settled (Rui, 11-11-2026):** a timetable sheet dropped anywhere still goes to *Calendário › Importar*, as it does from the calendar today (*"a timetablesheet contniues to go to calendar, but it is possible to drag and drop anywhere the same"*). No turmas importer exists (September 2026: the timetable import writes `evento` bookings), and creating turmas from a file stays its own later ticket.

**Open:**
1. Several files in one drop (a folder of boletins at the start of an época). Default: refused in v1, revisited once the pilot has used POOLSE-221.

### Dev notes

- No migration, no API route, no new file purpose. This is web only.
- `components/shell-drop.tsx`, mounted once in the backoffice shell beside `KeepFresh`. Reuse `FileDrop`'s window listeners and depth counter; do not write a fourth copy. A page target registers itself (a small context or a `data-drop-target` attribute read at `dragenter`) so the shell can stand down. The inventory and the register still carry their own hand-rolled listeners: they must register too, or two overlays fight.
- `lib/drop-destinations.ts`: one declaration per destination (`key`, i18n label, roles, module, `accepts`, `needs: 'site' | 'tank' | 'person' | null`, `href(subject)`, and the `MatchSpec` for a list). The seven specs are `STUDENT_MATCH`, `BOOKING_MATCH`, `PARTNER_MATCH`, `INVENTORY_MATCH`, `WATER_MATCH`, `SALARY_MATCH` and `qualifyingMatchSpec(groups)` (built at read time; its groups come from the API).
- `lib/drop-classify.ts`: pure, `classifyByHeadings(sheet, specs)` returning the ranked scores. Unit-tested against the real export of each importer (the round-trip fixtures exist).
- Roles: read them where `nav-entries.ts` reads them. Never a second list.
- `pending-file.ts` holds one file under one key. Each destination's key is its own; the importers that do not call `takeFile` yet gain one line.
- The trap: `dragenter` and `dragover` must both cancel, or the browser navigates to the file and the page is lost. And a dialog open means `KeepFresh` skips its tick, which is wanted here.
- Security read: type by first bytes on the server action as well as in the browser; `guard` the server action by role before `readSheet` (every export of a `'use server'` file is a public endpoint); the file name is shown with React's escaping and never used as a path; nothing is written to storage on this path.

### QA

1. Given an Owner on *Início*, when they drop the register's own export, then *Alunos* is preselected, and *Continuar* opens the student importer on its mapping step with that file.
2. Given the same drop on *Alunos › Importar*, then the page's own importer takes it and the shell dialog never opens.
3. Given a calendar block being dragged, then no overlay shows.
4. Given an Instructor, when they drop a salary list, then *Salários* is not offered and the dialog says it cannot place the file. Calling the classifying server action directly as a student answers a refusal.
5. Given a sheet whose headings match two specs equally, then nothing is preselected and both are listed.
6. Given a `.xlsm`, a `.exe` renamed `.pdf`, or an 11 MB PDF, then each is refused with its own sentence and nothing is read.
7. Given two files in one drop, then the drop is refused and nothing is read.
8. Given an image dropped on a tank's page, then *Fotografia de uma piscina* and that tank are preselected.
9. Given *Fotografia de uma pessoa* for a student with no photo consent, then the student's page refuses it as it does today (409 `photo_no_consent`).
10. Given club A's Owner, when the dialog searches for a person, then no person of club B is ever returned.
11. Given the keyboard alone, when Ctrl+K › *Importar um ficheiro* is used, then the whole flow completes. Light and dark mode both.
12. Given a module switched off for the club, then its destination is not listed.

### Acceptance criteria

- [ ] A file dropped on any backoffice page with no target of its own opens *O que é isto?*; a page's own target is unaffected.
- [ ] A spreadsheet is recognised by its headings with the existing matchers and no model call.
- [ ] Images, PDFs and LENEX files are asked, with the page's subject preselected.
- [ ] Only the reader's destinations are listed; the server action refuses by role in its first line.
- [ ] Every path ends on the destination's own review step or upload control; nothing is written by the drop.
- [ ] Ctrl+K action; pt-PT and en strings; `docs/features/importers.md` (or the nearest feature page) and one line in `docs/conventions/importers-and-exports.md` and `CLAUDE.md`.
