# Handoff — 05-11-2026 evening (Claude, cloud session → Claude Code)

The work of this session is **uncommitted**. The previous commit is `923d4030` (POOLSE-172, 174–178, 179 slice 1).

## Built this session (all uncommitted)
- **POOLSE-180**: the register on a phone, opened from `/app/aulas` (`compact` via `?from=/app…`).
- **POOLSE-181**: the maintenance home in the phone shell (*Hoje*, *Registar*, *Perfil*). There is no maintenance e2e login, so check QA 1–3 by hand.
- **POOLSE-179 slice 2**:
  - ID photos are sealed (`student_id_document`).
  - Families send documents through `family_submission`; nothing changes until the office accepts.
  - HEIC is converted to JPEG, and EXIF/GPS is stripped from every JPEG.
- **POOLSE-182**: the cost ledger (schema, `allocate_cost`, `/costs/*` API). There is no screen yet; that is 183.

Each ticket's **As built** section has the details and the security review.

## Before committing
1. `pnpm install`: new pinned dependencies `heic-decode` and `jpeg-js` in the API. The lockfile is already updated.
2. If `git status` shows many files changed with no real diff: `git add --renormalize .` (the new `.gitattributes`).
3. `pnpm db:migrate`, which applies 3 migrations: `1794653000000`, `1794653100000`, `1794653200000`.
4. `pnpm typecheck`, `pnpm db:test`, the API tests, and the e2e tests (`phone-poolside` has a new POOLSE-180 test).
   - Tested in the cloud: 616 SQL assertions, 1,397 API tests, and both typechecks, all green.
   - One web unit test (`date-format.test.ts`) failed there because of that machine's ICU. Check it here.

## Before go-live
- Run `apps/api/src/files/reseal-student-id-documents.ts`: a dry run first, then `--apply`, in staging and then production. It deletes the plaintext ID objects, which cannot be undone. See `docs/security.md`.

## Waiting on Rui
- **185:** should `guardian_link.can_view_progress` be ignored (suggested: guardians see progress by default), or should progress be opt-in per guardian?
- **182:** QA 4 expects equal months, but rule 2 gives by-day shares (101,92 € in January, 92,05 € in February). Rule 2 is what is built.

## Next
- **183**: the *Custos* screen, on `GET /costs/months` and `GET /costs/window`.
