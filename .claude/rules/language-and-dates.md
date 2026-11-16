---
paths:
  - "apps/web/src/**/*.{ts,tsx}"
  - "apps/web/src/messages/**"
  - "apps/api/src/common/club-day.ts"
---

# Language, dates and time

Read [`docs/conventions/language-and-dates.md`](docs/conventions/language-and-dates.md) before touching any user-facing string, date, time or long cell.

- Every date in Poolse is `dd-MM-yyyy` — prose, tables and `/admin` alike — and it comes from `formatDate` / `formatStamp` in `lib/date-format.ts`.
- A long cell keeps its start and ends in "…"
- A typed moment is the facility's wall clock, and "today" is `club_today()`.
- An elapsed time is `timeAgo` from `lib/relative-time.ts`
- Today in TypeScript is `clubToday()` from `apps/api/src/common/club-day.ts`
