# POOLSE-207 · The office says what kind of guardian a link is, is asked before linking an adult, and is told when a student turns 18

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Families / Backoffice · **Priority:** High (pre go-live) · **Depends on** [POOLSE-206](./POOLSE-206-a-parent-link-ends-at-majority.md), POOLSE-120 (attention circles) · **Unblocks** [POOLSE-208](./POOLSE-208-the-young-adult-confirms-and-the-family-is-told.md)

### PO — why this exists

POOLSE-206 gives a link its kind and ends a parent's rights at 18 on its own. This ticket is where people meet it. Rui chose four measures on 09-11-2026: *a warning on the record*, *flag on turning 18*, *no self-guardian* (built in 206) and *ask when linking an adult*. Without them a supported adult is entered as a parent's link and silently becomes independent at 18, and a 47-year-old with a seed "Pai" goes unnoticed, which is how this started.

**Not in scope:** the young adult's consents, invitation email and the family email (POOLSE-208); court documents; bulk re-classification of links.

### BA — rules

1. **The guardian form says the kind.** Adding or editing a guardian on a student offers *Encarregado de educação* (default) or *Acompanhante (maior acompanhado)*, with a one-line hint: *"Acompanhante: só para um adulto com acompanhamento decidido por tribunal."* The kind shows on the student's guardians list in words.
2. **Linking a guardian to someone at or over majority asks first** (Rui, 09-11-2026), with `components/ui/dialog.tsx`: *"Esta pessoa é maior de idade. É um adulto acompanhado?"* — *Sim, acompanhante* records `accompanying`; *Não* records `parental`, and says under it *"Fica só como quem paga: um encarregado não tem acesso aos dados de um adulto."*; *Cancelar* records nothing. The same question when a birth-date correction makes a student with a parental link an adult is **not** asked: the flag (rule 4) covers it.
3. **A warning on an adult's record with an acompanhante** (Rui, 09-11-2026), in words on the record's *General* tab: *"Maior de idade com acompanhante: na app é tratado como menor (o acompanhante responde por ele)."* With *Retirar acompanhante* (asks first, archives the link, records in Atividade). It never blocks anything (the "a warning never gates" convention).
4. **"Fez 18 anos" is a circle on *Alunos*** (Rui, 09-11-2026), for owner and admin: every student who reached majority in the last 60 days and still has a live `parental` link, until somebody acts. The list says, per student, the birthday and the parent, and offers: *Confirmar* (nothing changes: the parent stays payer only), *É acompanhante* (turns the link `accompanying`, asks first), and, when the student has an email and no login, *Convidar para a app* (the existing student invitation, never sent automatically). Acting on a student clears their row; the circle clears when the list is empty (the "a circle means something needs doing" convention).
5. A self-guardian refusal (POOLSE-206) reaches the form as words: *"Uma pessoa não pode ser encarregada de educação de si própria."*
6. Every change of kind, removal and confirmation records what it changed in Atividade and can be reverted through its own path.

### Dev notes

- API: `PATCH /students/:id/guardians/:linkId` takes `kind`; `GET /students/turned-18` (owner, admin; first line `requireRole`); `POST /students/:id/majority-review` with `{ action: 'confirm' | 'accompanying' }`. A role probe line for each.
- The review needs a record so the row clears: `majority_review (organization_id, student_id, reviewed_at, reviewed_by, action)`, tenant table (composite FKs, RLS, `TENANT_TABLES` in the harness, child-first). One row per student per majority.
- The circle is one more entry in POOLSE-120's attention read; the menu badge follows from it.
- Ctrl+K: the *Fez 18 anos* list gets a palette entry (`nav-entries.ts`), per the standing AC of 04-11-2026.
- i18n pt-PT and en for every string above; the Portuguese is Rui's wording here.

### QA

1. Given a 17-year-old, when the office adds a guardian, then no question is asked and the link is `parental`.
2. Given a 25-year-old, when the office adds a guardian and answers *Sim, acompanhante*, then the link is `accompanying` and the record shows the warning; answering *Não* records `parental` and no warning.
3. Given a student who turned 18 last week with a parental link, then *Alunos* shows a circle and the list names them; *Confirmar* clears the row and the circle, and Atividade records it.
4. Given the same student with an email and no login, then *Convidar para a app* is offered and nothing is sent until it is pressed.
5. An instructor calling `GET /students/turned-18` gets 403; a club B student id posted to club A's review gets 404.
6. Light and dark: the warning and the list read at AA in both themes; the warning is words, not colour alone.

### Acceptance criteria

- [ ] Kind on the guardian form and list, with the hint.
- [ ] The adult question on linking, three answers, nothing recorded on *Cancelar*.
- [ ] The acompanhante warning with *Retirar acompanhante*, never blocking.
- [ ] *Fez 18 anos* circle and list with *Confirmar*, *É acompanhante*, *Convidar para a app*; clears on action.
- [ ] `majority_review` with RLS, composite keys, in `TENANT_TABLES`.
- [ ] QA 1–6 as tests; role probe updated; palette entry added.
