# POOLSE-165 · Pedidos moves under Receção, the public form keeps the complaints book as one footer line, and handling a pedido says what happened

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature / Bug · **Area:** Reception / Registration / Navigation · **Priority:** Medium (pilot) · **Depends on** [POOLSE-69], [POOLSE-73], [POOLSE-143] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Registration requests' submenu should go to 'Reception' submenu instead, it makes sense"; "the public form does not need the 'livro de reclamações'"; "when a request is handled send some feedback message to the user approving, dismissing, etc., it's not very clear what happened".

On the complaints book: decided 04-11-2026 (Rui) to **keep it as one small footer line** rather than drop it — DL 156/2005 requires the link on a provider's pages and POOLSE-73 put it on every public page for that reason.

**Not in scope:** emailing the visitor who filed the pedido (that is POOLSE-82's offer flow); the form's fields.

### BA — rules
1. The *Pedidos* entry leaves the Alunos group and sits under Receção; its `perSport: 'copy'` stays, so each sport's group keeps its filtered copy. Addresses do not change; `also` claims them.
2. The public pre-registration page renders `PublicNotices` in compact mode: one line of small muted text at the foot (complaints-book link + regulation link), never a card above the form.
3. Handling a pedido — *Colocar*, *Oferecer*, *Recusar*, *Arquivar* — returns `toastKey` so `useSavedAction` says *Aluno colocado em {turma}*, *Oferta enviada*, *Pedido recusado*, *Pedido arquivado*, each once; a refusal names the field. A recusa with *Anular* restores it through the bin (POOLSE-78) where the kind is `RESTORABLE`.
4. Palette actions move with the entry; synonyms unchanged.

### Dev notes
- `nav-entries.ts`: move the entry object; `sectionOf` derives the section from the address, so verify the Receção group lights up on `/dashboard/students/requests`.
- `PublicNotices` gets a `compact` prop; both public pages keep the full version except the form.
- Toasts: the server actions in `requests/actions.ts` return `{ toastKey, values }`.
- Trap: a one-tap action whose row leaves the list must not `revalidatePath` before the toast (POOLSE-90 lesson).

### QA
1. Given the sidebar, then Pedidos is under Receção and absent from Alunos; the per-sport copies remain.
2. Given the public form, then the footer line has both links and the form is first.
3. Given *Recusar*, then one toast *Pedido recusado* with *Anular*; *Anular* brings it back.
4. Given *Colocar* on a clashing turma (POOLSE-144), then the refusal sentence names the turma, no toast of success.
5. Both themes on the public page (its own layout).

### Acceptance criteria
- [ ] Entry moved; section highlight correct; palette follows.
- [ ] Compact notices on the form, links present.
- [ ] One toast per handling outcome, with Anular where restorable.
