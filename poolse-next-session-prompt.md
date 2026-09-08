# Poolse — next session prompt

Paste this into Claude Code in VS Code (repo: Poolse):

---

Continue Poolse from the 8 September handover. Before touching code, read `CLAUDE.md`
and the **Round 9 and Round 10 entries** of `docs/decisions.md` — that is the whole
handover. Skim `docs/roadmap.md` phase 2 for context only; do not re-derive the plan.

## Where things stand

Twelve commits sit on `feat/fees-and-adult-path`, pushed. The branch was renamed from
`feat/fee-kinds` before the push, because the old name had stopped describing its
contents several commits earlier.

Landed since the last handover:

- The `occurs_on` drift, fixed with the two tests that reproduce it.
- **Fee kinds** — `fee_kind` is `mensalidade | inscricao | seguro | quota` on one price
  list, with a recurrence, VAT (gross, with `isento` as its own flag) and a season on
  the two kinds that have one.
- **Seguro, both sides** — an `insurance_policy` (apólice) on the facility, and a
  student cover line with mid-season pro-rata and a no-cover warning that blocks nothing.
- **Inscrição** with a renovação price chosen by default for a returning student.
- **POOLSE-23**, closed except AC7: the adult path, the consent-form 422 guard,
  mobility notes, the emergency contact, the fee category, and both badges on one record.

`pnpm api:test` is 450/450 and every check is green. Two fixtures that used to fail on
a clock were pinned, so a red run now means a real regression.

## Tonight: phase 2.2 — invoice generation

The kinds and the VAT columns went in specifically so invoice lines would have something
to carry, so this is the slice they were built for. Series, sequential numbering, lines,
VAT.

**Ask me these three before any code, and write the answers to `docs/decisions.md`:**

1. **Are these legal invoices or internal records?** Portugal requires certified software
   (Decreto-Lei 28/2019) for issuing invoices, with the ATCUD code, the QR code and a
   SAF-T export. If Poolse is issuing the real thing, that is a certification programme
   and not an evening; if it is producing internal records that a club's own certified
   software then issues, the scope is a tenth of that. This decides everything below it,
   so ask it first and do not guess.
2. **One numbering series per organization, or per facility?** A series has to be
   sequential and gap-free within itself. A club with two pools can run one series or
   two, and the answer is not recoverable later without renumbering.
3. **What creates an invoice** — a monthly run over every active fee line, a per-student
   action, or both? And does an invoice cover one student or one family (the sibling pair
   the roadmap's "done when" names)?

**The rule most likely to be got wrong:** a number, once issued, can never be reused,
back-filled or edited. A correction is a credit note against the original, not an edit.
Whatever the answers above, build the numbering so that is structurally true — allocated
inside the transaction that writes the invoice, never in application code that could
retry.

**Out of scope tonight:** Stripe, débito direto, MB WAY, and chasing (2.3).

## Standing rules

- Docs updated in the same commit as the behaviour or schema change; `CLAUDE.md` kept
  current with any new convention.
- Refactors proposed in one line and gated on my OK — never inlined.
- Confirmed decisions appended to `docs/decisions.md`.
- **Ask questions directly, when they come up, rather than collecting them into the
  closing summary.**
- Migrations: consult the `write-migration` skill, every new table carries the tenant key
  and its RLS policy, and the tenant-isolation test is green before the slice is done.

## Loose ends, if you want something smaller instead

- **POOLSE-23 AC7** — communications routed to an adult student rather than a guardian.
  Not buildable: `notifications/` sends invitation and vacation email and there is no
  messaging feature to route through. It needs the messaging feature first.
- The dev database has demo data for all of the above — an apólice, three fee categories,
  a lapsed cover, an adult with both badges. It is seeded directly and not in the repo.
