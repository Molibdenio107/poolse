# POOLSE-232 · One shared Button, and every page's main "add" and "Importar" stand out from the cards around them

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Interface / Backoffice / App · **Priority:** Medium (pilot) · **Unblocks** [POOLSE-233](./POOLSE-233-an-empty-list-offers-its-first-action.md)

### PO — why this exists

Rui, 19-11-2026: *"+ Nova tarefa"*, *"+ Novo espaço"* and *"Importar"* look like plain cards. Every page declares its own button style. **63 files** carry a local `const BUTTON` (counted 19-11-2026; the brief said ~170), most of them `bg-surface shadow-card`. That is the handoff's secondary look (`interface.md`, POOLSE-139). So the one thing a page exists to start reads the same as everything else on it.

**Not in scope:**
- Migrating every button. This ticket switches **only** each page's main add action and its *Importar*. The rest stays.
- Row actions, dialog buttons, `ConfirmButton`, `ARCHIVE_TRIGGER`, the calendar's chips.

### As built (19-11-2026) — wins over the rules below where they differ

- **`buttonClass(variant)` in place, `<Button>` for new code.** Each switched control kept its element and markup (a `FromLink`, a button with its own handler), and only its class became the shared one. That is the smallest change, and the visual result is the same. `<Button>` is what new code uses.
- **The outline is the primary *ink*, not the fill.** `contrast:check` found the fill at 2.72:1 on white, under a control edge's 3:1.
- **Header buttons are `PageAction`**: a window event the panel listens for (`usePageAction`), so Inventário's add form and importer, and Energia's import card and add-meter dialog, stay where they were and open from the header. Energia's *Adicionar contador* is in the header only when the club has one site. With several, each site's panel keeps its own.
- **Not switched**, because they are not page buttons:
  - *Novo rascunho* (Épocas), *Adicionar nível* (Níveis) and Inventário's own *Adicionar artigo* are fold-out headings. The header button opens the latter.
  - *Adicionar encerramento* is a dialog's submit.
  - The maintenance home's *Registar análise* is a list row per tank.
- **On `main`** the onboarding wizard does not exist yet, so its *Novo tanque* is not in this ticket. It lands with POOLSE-228.

### BA — rules

1. **One component, `components/ui/button.tsx`**: `<Button variant="primary" | "secondary" icon={…}>`. It renders a `<button>`, or a `FromLink` when given `href`, so the existing `FromLink` back rule still holds.
   - **primary:** the brand fill (`bg-primary`) with `text-primary-foreground` (the dark ink, 6.6:1, `interface.md`).
   - **secondary:** outlined (rule 2).
   - **Both:** `h-control` / `text-control`, a focus ring, a disabled state with an unchanged look apart from opacity and the `disabled` attribute, an optional leading icon (`aria-hidden`), and `min-h-control` where words may wrap on a phone.
2. **Secondary is outlined teal** (Rui, 19-11-2026): a 1 px `border-primary` with `text-primary` ink, so *Importar* reads as a related action beside the filled one. This is an exception to the handoff's secondary (`bg-surface shadow-card`, no border, POOLSE-139), for these buttons only. Every other secondary button keeps the handoff's look until the gradual migration (rule 6). That is a dated line in `docs/decisions.md`.
3. **Switched now** (the main add action is primary, *Importar* secondary; real labels, checked 19-11-2026):
   | Page | Primary | Secondary | File |
   |---|---|---|---|
   | Instalações | Adicionar instalação | — | `facilities/page.tsx` |
   | Instalação › tanques | Novo tanque | — | `facilities/[facilityId]/page.tsx` (pools section), `setup/page.tsx` |
   | Espaços | Adicionar espaço | — | `facilities/spaces-panel.tsx` |
   | Manutenção | Nova tarefa | — | `facilities/maintenance-panel.tsx` |
   | Inventário | **Adicionar artigo** | **Importar de ficheiro** | `facilities/inventory/inventory-panel.tsx` → page header |
   | Energia | **Adicionar contador** | **Importar fatura** | `facilities/energy-panel.tsx`, `energy/import-bill-card.tsx` → page header |
   | Contador | Registar leitura | Importar fatura | `facilities/energy/[meterId]/meter-forms.tsx`, `[meterId]/page.tsx` |
   | Ocorrências | Registar ocorrência | — | `facilities/incidents/page.tsx` |
   | Nadadores-salvadores | Novo período | — | `facilities/lifeguards/periods.tsx` |
   | Staff | Convidar utilizador | Importar ficheiro (Salários) | `staff/invite-panel.tsx`, `staff/salaries/salary-file-panel.tsx` |
   | Parcerias | Nova parceria | Importar parcerias | `[facilityId]/partners-panel.tsx` |
   | Turmas | Nova turma | — | `classes/page.tsx` |
   | Épocas | Novo rascunho | — | `classes/seasons/season-drafts.tsx` |
   | Níveis | Adicionar nível | — | `students/levels/page.tsx` |
   | Alunos | Adicionar aluno | Importar | `students/import-panel.tsx` |
   | Mensagens | Nova mensagem | — | `students/messages/page.tsx` |
   | Provas | — | Importar resultados | `students/provas/import-meet.tsx` |
   | Calendário | — | Importar horário | `calendar/import/import-panel.tsx` |
   | Encerramentos | Adicionar encerramento | — | `calendar/closures/closure-calendar.tsx` |
   | Receção | Nova pessoa | — | `rececao/person-desk.tsx` |
   | Piscina › água | Registar análise | Importar relatório | `pools/[poolId]/water-import.tsx` and its record link |
   | App, family | Pedir inscrição numa turma | — | `app/familia/page.tsx` |
   | App, maintenance | Registar análise | — | `app/manutencao` home |
4. **Inventário and Energia put both in the page header** (`PageShell actions`), where *Inventário*'s are now inside the panel and Energia's import is a card. **Correction to the brief:** Energia's page-level actions are *Adicionar contador* and *Importar fatura*. *Registar leitura* belongs to a meter's own page (row *Contador*), and Inventário's import says *Importar de ficheiro*. The labels stay as the catalogue has them.
5. **The same roles as today see each button.** A button only appears where the page already showed it, and the server still refuses as it does.
6. **Refactor by proposal:** the remaining local `BUTTON` constants (63 files) move to `<Button>` page by page, each when its file is next touched. That is one line in the ticket and in `interface.md`, never a sweep.

### Dev notes

- Add the component's two fills to `contrast:check`'s `PAIRS` (primary text on primary fill; primary ink on surface for the outline) in both themes.
- One line in `interface.md` (*A page's main action is `<Button variant="primary">`*) and in `.claude/rules/interface.md`.
- The handoff's secondary convention line gets the exception (rule 2) in the same commit.
- No API change.

### QA

1. On each page in rule 3, the main add action is the filled brand colour and *Importar* is outlined, in light and dark, both passing `contrast:check`.
2. Keyboard: Tab reaches each button and shows the focus ring. A disabled button is skipped and reads as disabled.
3. Inventário and Energia show both actions in the page header at 1280 px and stacked at 360 px with no sideways scroll.
4. **Wrong role:** an instructor on Inventário sees what they saw before (maintenance writes the inventory; `INVENTORY_EDITORS`). A maintenance user on Energia sees *Adicionar contador* only if today's page shows it. Posting the add directly as a guardian → 403, as today.
5. Cross-tenant: no route changes, so the existing tests cover it.
6. A long label (en) wraps inside `min-h-control` on a phone without clipping.

### Acceptance criteria
- [x] `components/ui/button.tsx` with primary and secondary, icon, disabled and focus states, contrast pairs added.
- [x] Every row of rule 3 switched; nothing else.
- [x] Inventário and Energia actions in the page header.
- [x] `interface.md` and `.claude/rules/interface.md` updated with the outlined-secondary exception; decision line written.
