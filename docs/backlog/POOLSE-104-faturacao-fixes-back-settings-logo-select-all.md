# POOLSE-104 · Faturação: Voltar on a document, settings with the club, the logo with the photographs, select all overdue

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX · **Area:** Billing / Club data · **Priority:** Medium · **Depends on** [POOLSE-91](./POOLSE-91-back-returns-to-where-you-came-from.md), [POOLSE-94](./POOLSE-94-club-payment-details-iban-mbway.md)

### PO — why this exists

Rui's test pass, 22-10-2026, four items on Faturação and where its settings live.

### The items

#### A · A document's page uses Voltar, not "Voltar à faturação"

- `faturacao/[id]/page.tsx` renders its own link (*Voltar à faturação*, ≈ l.182) instead of the shell's `back`. Replace it with `PageShell`'s `back` via `backTarget(from, …)`, so it reads *Voltar* like every other page (POOLSE-91) and returns to the month and view it was opened from.

#### B · Faturação's *Configuração* moves to *Dados do clube*

- The settings view (`view=settings`: the invoice **series** panel, plus the pointer to club data) leaves Faturação. The *Séries* panel becomes a card on the site page's **Clube** tab, under the NIPC and *Como pagar* cards (POOLSE-94). Faturação keeps *Mês*, *Em dívida* and nothing else.
- Keep one line on Faturação for a month: *"A configuração está agora em Instalações → Clube"*, with the link, as was done when the NIPC moved on 13-10-2026. Remove it after the pilot.
- Series are per site (`facilityId`); the Clube tab is per site, so nothing changes in the model.

#### C · The club logo moves to the *Fotografias* tab

- `LogoPanel` leaves the Clube tab and sits at the top of the **Fotografias** tab, above the site photographs: *Logótipo do clube* (club-wide, said so) then *Fotografias da instalação*.

#### D · Em dívida: select all overdue, unselect all

- The checkbox column in `outstanding-list.tsx` gets a header checkbox: ticks every **overdue** row shown (not rows that are open but not yet due), with an indeterminate state when some are ticked, and unticks all on a second click. The bulk reminder (POOLSE-86 3.0b) then applies to the selection, including its 7-day warning per family.
- Keyboard: the header checkbox is a real `<input type=checkbox>` with a label *Selecionar todos em atraso*.

### QA — scenarios

1. **A:** From Em dívida, open a document and click Voltar: back on Em dívida. From Mês, back on that month.
2. **B:** Faturação has no Configuração view; the series panel is on the site's Clube tab and still creates and edits series.
3. **C:** The logo upload is on Fotografias, above the site photographs, and still shows on the invoice PDF.
4. **D:** With 3 overdue and 2 open documents listed, select-all ticks 3; a second click unticks; the reminder dialog lists the 3 families.

### Acceptance criteria

1. Items A–D done.
2. Both languages, light and dark, phone layout for Em dívida (POOLSE-88 cards keep the checkbox reachable).

### Open questions

- None.
