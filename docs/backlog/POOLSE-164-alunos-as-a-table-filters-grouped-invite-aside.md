# POOLSE-164 · Alunos is a table — sport, nível, turma, mensalidade em atraso — with every filter in one place and *Convidar* out of the way

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students · **Priority:** Medium (pilot) · **Depends on** [POOLSE-143], [POOLSE-148], [POOLSE-129] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Students' main page should be rearranged, with a table list of records having columns for each 'sport', 'level', 'payment overdue' etc. If needed we can make the page bigger, to fill more screen space"; "'invite members' should be on the right side of the page, not so easily accessed"; "'swimming', 'no sport' etc. should be in the filter section, we need to group all filters".

**Not in scope:** the record page; bulk actions; export columns (unchanged).

### BA — rules
1. Columns: Nome (link), Idade, Desporto(s) (`SportChip`, multi-sport only), Nível (per sport, POOLSE-148), Turma(s), Seguro (three words, existing), Mensalidade (*em dia / em atraso*, from `balance`), Acesso (last seen). Paginated at 10, sortable by name and age.
2. Every filter — search, sport, level, turma, *sem turma*, overdue, seguro — sits in one *Filtros* row above the table, `?`-param backed; the sport pills leave the heading.
3. *Convidar membros* moves to the page header's right, as a secondary button behind the primary *Novo aluno*.
4. Width: the page takes `width="wide"` — **this is the second caller after the calendar**, taken out loud (Rui, 04-11-2026: "we can make the page bigger"). Record it in decisions.md.
5. Below `md`: `.table-stack` cards; the filter row scrolls (`ScrollArrows`).
6. The instructor's sport scope (POOLSE-145) filters rows and the sport filter's options.

### Dev notes
- `students/student-list.tsx`; the overdue flag must come from `fee-balance.ts` in one grouped query, never a loop per student.
- Filters through `readSportFilter` and the existing list params; keep `?from=` on the name link.
- Trap: a `width="wide"` third caller is a decision, not a tidy-up — say so in the component comment.

### QA
1. Given 25 students, then 10 rows with the columns, Desporto absent in a pool-only club.
2. Given `?overdue=1`, then only students with an overdue occurrence.
3. Given instructor scoped to Ténis, then no swimming rows and no swimming option.
4. Given 390 px, stacked cards, filters in one scrolling row.
5. Guardian → 403 on the list endpoint (existing).
6. Both themes.

### Acceptance criteria
- [ ] Table columns as rule 1; one grouped overdue query.
- [ ] One filter row; sport pills moved into it.
- [ ] Invite button secondary, right.
- [ ] Wide width recorded in decisions.md; phone stack.
