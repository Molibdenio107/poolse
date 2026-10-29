---
name: poolse-ticket
description: Write a Poolse backlog ticket (docs/backlog/POOLSE-NNN-*.md) from a brainstorm, a user story, a bug report or a decision taken in chat, in the repo's four-view template — PO, BA, Dev, QA, acceptance criteria — and wire it into the README index and docs/decisions.md. Use whenever Rui says "make a ticket", "add this to the backlog", "write that up for Claude Code", or a conversation ends with a decision that should outlive the chat. Also use to split one big idea into several tickets with dependencies.
---

# Writing a Poolse ticket

A ticket is loaded alone, with `CONVENTIONS.md`, at the start of an evening session. It has
to carry everything that session needs and nothing it does not: the reasoning, the rules,
where the code goes, and the tests already written as scenarios.

## Before writing

1. `ls docs/backlog/` and take the next number (the index is `README.md`; the last row is
   the last number). Slug: `POOLSE-NNN-kebab-title.md`.
2. Read the one or two tickets the new one depends on, so rules and names match theirs
   (`class_schedule`, `booking_lane`, `playing_area`, `space`…). Grep `docs/data-model.md`
   for every table you name; never invent a column.
3. Check `docs/decisions.md` for a prior call on the same subject. A ticket that reverses one
   says so, names it, and dates the reversal.

## The template

```
# POOLSE-NNN · Title as one sentence that says what changes for whom

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature | Bug | Architecture | Sweep · **Area:** … · **Priority:** High (pre go-live) | Medium (pilot) | Low (post go-live) · **Depends on** [POOLSE-…] · **Unblocks** [POOLSE-…] (optional)

### PO — why this exists
Quote Rui, dated (dd-MM-yyyy), in his own words. Then the one paragraph of reasoning.
**Not in scope:** the things a builder would otherwise drift into. Always present.

### BA — rules
Numbered. Each rule is testable. Decisions Rui took get "(Decided N)" or "(Rui, date)".
Open points are marked **Open:** with the default to take if unanswered.

### Dev notes
Tables, columns, triggers, endpoints, which `@poolse/rules` module, which skill applies
(`write-migration` for SQL). Name the trap the last similar ticket fell into.

### QA
Numbered Given/When/Then scenarios, including: one cross-tenant denial, one permission
denial against the endpoint, both themes where UI changes, and "nothing the pilot sees
changes" with a snapshot when that is the rule.

### Acceptance criteria
- [ ] checklist, the contract.
```

Open questions a ticket leaves are counted in the README's *Open* column.

## Wiring

- Append a row to the index table in `docs/backlog/README.md`: ticket, title, area,
  priority, depends on, open count. Do not renumber or reorder.
- If the ticket records a product call, append one dated line to `docs/decisions.md`,
  newest last, bold lead, "(Rui)" where it was his, "**reverses**" where it does.
- If it changes a standing rule, edit the relevant paragraph of `CLAUDE.md` in the same
  commit, and say so in the ticket.
- Do not commit; Rui commits.

## Splitting

One idea that touches schema, billing, navigation and the app is four tickets with
dependencies, not one. Order them so each is one evening: the schema one first and
invisible, the visible ones last. Put the heavy or risky one in its own ticket with a
"re-confirm before starting" line and a written fallback, so go-live can slip around it.

## Voice

Plain, specific, no hedging. Rules say what happens, not what "should" happen. Quote Rui
rather than paraphrase him when a line is the reason for a ticket. pt-PT product terms
(turma, recinto, época, reposição, encarregado de educação) stay in Portuguese.
