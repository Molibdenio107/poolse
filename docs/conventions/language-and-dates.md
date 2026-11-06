# Language, dates and time

The full text of the conventions for any user-facing string, date, time or long cell. `CLAUDE.md` holds one line each; read this file before changing that area.

**Every date in Poolse is `dd-MM-yyyy` — prose, tables and `/admin` alike — and it comes from
`formatDate` / `formatStamp` in `lib/date-format.ts`.** One shape, one definition, 13 September
2026. `Intl` cannot produce it: there is no separator option, `pt-PT` writes 13/09/2026 and
`en-US` writes 09/13/2026, so the named `long`, `short` and `stamp` were **removed** from
`i18n.ts` rather than left pointing at the old shape — asking for one now fails
`pnpm i18n:check` loudly. **An options object at a call site fails the same check**, which is
how twenty of them quietly rendered slashes for a year — but only where it is spelled
`dateStyle` or `timeStyle`: **the check sees neither `{ day, month, year }` nor a bare
`new Intl.DateTimeFormat`**, which is how four dates were still reading "13 de setembro de 2026"
a fortnight later. Grep for both before trusting it. A sentence that needs the time on its own
takes **`formatTime`** from the same file rather than asking next-intl for `{ hour, minute }`,
which renders 14:30 in Portuguese and 2:30 PM in English. What stays named in `i18n.ts` is
`month` and `monthShort`, which are month *names* and properly the reader's language; they are
still defined once and passed to *both* `getRequestConfig` and `NextIntlClientProvider`,
because a client provider inherits the locale and timezone from the server but neither the
messages nor the formats. The timezone is `APP_TIME_ZONE`, exported from the same file, so the
formatter and next-intl cannot disagree — and a `YYYY-MM-DD` string is parsed as a *day*, never
as a UTC instant, which is the off-by-one that made a rate effective on 1 October read as
30 September. `asDate` makes it noon UTC, so the browser's own zone cannot move it either, and
`lib/dates.ts` no longer writes a date at all — `shortDate`, `mediumDate` and `longDate` are gone,
day-column headers included. **One exception, for headings only** (POOLSE-96): `formatDateRange`, `formatDateLong`, `formatDayMonth` and `formatDayMonthShort` in the same file write a week or a day out in words through `Intl` (`en` as `en-GB`) — the lifeguard week's heading and columns, a student's *Semana* tab (POOLSE-108), the calendar's week heading and day headers (POOLSE-107) and the family's *Aulas* strip (06-11-2026), and nothing else unless Rui asks. `formatDayMonthShort` composes day and abbreviated month, because `Intl` asked for both writes pt-PT as 16/11. A client-side week stepper changes only `?week=` through `withWeek` (`lib/week-url.ts`), never rebuilding the address from the path, which drops `?tab=` and `?from=`.

**A long cell keeps its start and ends in "…"** (Rui, 04-11-2026, reversing a middle cut the same day): `shorten` (`lib/shorten.ts`), and in a table `ShortText` (`components/short-text.tsx`), whose `Hint` holds the whole and opens on focus; the record's page still says it in full.

**A typed moment is the facility's wall clock, and "today" is `club_today()`.** A
`datetime-local` value goes to the API as typed and is resolved there in `facility.timezone`
(`facilities/sample-moment.ts`: `resolveSample` for a pool, `localInstant` for a meter or a
task) — never `new Date(raw)` on a UTC server. In SQL, a day is `club_today()`, never
`current_date`, including column defaults. 13-10-2026 sweep.

**An elapsed time is `timeAgo` from `lib/relative-time.ts`**, which returns the phrase and lets
`t('…', { ago })` own the word order. Never build "há 2 dias" in a component: it is a
Portuguese string hard-coded into an interface that ships in two languages.

**Today in TypeScript is `clubToday()` from `apps/api/src/common/club-day.ts`**, the twin of `club_today()` — never `new Date().toISOString().slice(0, 10)`, which is yesterday between midnight and one in a Lisbon summer. In the web app it is `today()` from `lib/dates.ts`, which is the club's day wherever it runs (16-10-2026 sweep).
