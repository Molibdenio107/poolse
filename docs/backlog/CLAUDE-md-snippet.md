# Snippet for your repo's CLAUDE.md

Append this to the `CLAUDE.md` at the root of the Poolse repo. It tells Claude Code where the backlog
lives and — more importantly — **not to load all of it**, which is the whole reason the spec was
split into per-ticket files.

Copy everything below the line.

---

## Backlog

The backlog lives in `docs/backlog/`, one file per ticket (`POOLSE-01…36`).

- `docs/backlog/README.md` — index of all tickets with area, priority and dependencies.
- `docs/backlog/CONVENTIONS.md` — standing rules that apply to every ticket, and the definition of done.
- `docs/backlog/CONFLICTS.md` — known contradictions between tickets and their resolutions.
- `docs/backlog/BUILD-ORDER.md` — dependency order and how a build session runs.

**When working on a ticket, read that ticket's file and `CONVENTIONS.md`. Do not read the whole
backlog folder** — it is ~2,300 lines and loading it wastes the session's context on tickets that
are not being built.

Each ticket file contains four sections plus the acceptance criteria:

- **PO** — why it exists and what is explicitly out of scope. Respect the out-of-scope line; do not helpfully build the adjacent thing.
- **BA** — the business rules and data. Anything marked `**Open:**` is genuinely undecided: ask rather than picking an answer.
- **Dev** — schema and migration impact, API surface, where the logic belongs, and the thing most likely to be got wrong.
- **QA** — numbered `Given / When / Then` scenarios. These are the tests to write, including the permission-denial and negative ones.
- **Acceptance criteria** — the contract. A ticket is not done until every numbered criterion is met.

### Non-negotiables for every ticket

- Permissions are enforced server-side; hiding a control is never the control.
- Every tenant table carries the tenant key; every query is scoped.
- Every user-facing string goes through i18n (pt-PT + en) as it is written.
- Light and dark mode, contrast-checked; colour never carries meaning alone.
- History is soft-deleted, never destroyed.
