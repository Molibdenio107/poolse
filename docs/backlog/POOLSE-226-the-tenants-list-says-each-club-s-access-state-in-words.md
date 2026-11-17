# POOLSE-226 · The tenants list says each club's access state in words, and filters by it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / `/admin` · **Priority:** Medium (pilot) · **Depends on** [POOLSE-61](./POOLSE-61-trial-lifecycle.md), [POOLSE-62](./POOLSE-62-trial-abuse.md), [POOLSE-64](./POOLSE-64-hardening-admin.md) · **Pairs with** [POOLSE-225](./POOLSE-225-a-club-s-owners-are-emailed-when-the-platform-suspends-or-restores-it.md)

### PO — why this exists

> "GET /platform/tenants and the Plataforma club list should show each club's access state as
> visible text, not a tooltip: Ativo, Só leitura (since when), Suspenso (since when, with the
> reason shown in full on the club's page), Dados a apagar em dd-MM-yyyy when pending_delete_at is
> set, and Arquivado. Colour must not carry the meaning alone. Add a filter by state." (Rui,
> 17-11-2026)

The list's *Subscrição* column says what a club pays. It does not say whether the club's door is
open. Today the only access signal on the list is an *Eliminada* chip beside an archived club's
name. To see whether a club is read-only or suspended, an operator has to open each club's page.
Access state is the first thing an operator needs on a support call, so it gets its own column
and its own filter.

**Not in scope:**
- Any change to how a club is suspended, made read-only, restored or archived. The cards on the
  club's page stay as they are.
- Emailing the Owners. That is POOLSE-225.
- The trial clock's ladder and its dates.
- Server-side sorting by state.
- The club's own suspended screen (`suspended-notice.tsx`).

### BA — rules

1. **Every tenant row carries one access state**, `accessState`, worked out in SQL in the list
   statement: `archived` if `archived_at` is set, else `suspended` if `suspended_at` is set, else
   `read_only` if `read_only_at` is set, else `active`. This is the precedence the middleware
   already applies (decided 14-09-2026), with archive above it.
2. **The list shows that state as a word with its own icon**, in a new *Acesso* column:
   - *Ativo*
   - *Só leitura · desde dd-MM-yyyy*
   - *Suspenso · desde dd-MM-yyyy*, with the reason on a second line, cut to one line
   - *Arquivado · desde dd-MM-yyyy*

   The word and the date are text. Colour only helps the eye find a row: every state has a
   different icon and reads correctly in greyscale.
3. **When `pending_delete_at` is set**, the cell carries a second line in any state: *Dados a
   apagar em dd-MM-yyyy*.
4. **The suspension reason in full is on the club's page.** The suspension card already quotes
   it, and that stays. The list's one-line cut is visible text and ends in an ellipsis. It never
   opens in a tooltip.
5. **The *Eliminada* chip beside the name goes.** The *Acesso* column says *Arquivado*, and the
   same fact twice on one row in two different words is one too many.
6. **A filter by access state**, as its own row of links labelled *Acesso*: *Todos*, *Ativo*,
   *Só leitura*, *Suspenso*, *Dados a apagar*, *Arquivado*. It is a separate query parameter,
   `access`, so it combines with the existing *Mostrar* filter. For example, *Em avaliação* and
   *Suspenso* together show trials an operator has shut.
7. ***A caminho de eliminação* moves from *Mostrar* to *Acesso*,** as *Dados a apagar*. The API
   still accepts `filter=pending_delete`, so a saved link keeps working. Unlike the other access
   states, *Dados a apagar* matches on `pending_delete_at` whatever the club's state is.
8. **An unknown `access` value is no filter**, the rule the existing filter follows: this arrives
   in a URL, and a typo shows everything rather than an error page.
9. **Dates are `dd-MM-yyyy` in Lisbon**, like the trial's end date in the column beside it.

### Dev notes

**API** (`apps/api/src/platform/`):
- `platform.repository.ts`, `listTenants`:
  - Add an `access_state` CASE to the `SELECT`, and the filter
    `($8::text IS NULL OR access_state = $8 OR ($8 = 'pending_delete' AND o.pending_delete_at IS NOT NULL))`.
  - Write the CASE once, as a constant, and use it in both the select and the `WHERE`, so the
    state shown and the state filtered cannot drift apart.
  - `TenantRow` gains `accessState: AccessState`.
  - Add `ACCESS_FILTERS`, the access states plus `pending_delete`.
  - `readTenant` passes `access: null`.
- `platform.controller.ts`, `tenants`: read `@Query('access')` the same way as `filter`. An unknown
  value becomes null. Only values from the constant list ever reach SQL.
- No migration. Every column already exists.

**Web** (`apps/web/src/app/(app)/admin/`):
- `lib/api.ts`: `PlatformTenant.accessState`.
- New `access-badge.tsx`, modelled on `subscription-badge.tsx`: icon plus word, full class names,
  and a fallback for an unknown value.
- `page.tsx`:
  - Add an *Acesso* column after *Subscrição*.
  - Add an `AccessLinks` row beside `FilterLinks`.
  - Carry `access` through the search, pagination, sort, section and past-the-end redirect
    links, exactly as `filter` is carried.
  - Remove the archived chip from the name cell.
- i18n keys go under `admin.access.*` and `admin.accessFilter.*`, in pt-PT and en.
- Run `pnpm pt:check` before committing the keys.

**Docs:** in `docs/features/platform.md`, the list's columns and filters.

**Traps:**
- `FilterLinks` and `SortLinks` each build their own hrefs and silently drop the parameters they
  don't know about. Every link builder on this page has to carry `access`, or choosing a sort
  loses the filter.
- The translucent chips on coloured cells failed contrast once (POOLSE-53). Run
  `pnpm contrast:check`.

### QA

1. **Each state.** Given four scratch clubs (one open, one read-only, one suspended, one archived),
   `listTenants` narrowed to each club returns `active`, `read_only`, `suspended` and `archived`.
2. **Precedence.** A club that is both suspended and read-only is `suspended`. A suspended club
   that is also archived is `archived`.
3. **Filter by state.** `access=suspended` returns the suspended club and not the read-only one.
   `access=active` returns the open club and not the suspended one.
4. **Dados a apagar.** A read-only club with `pending_delete_at` set is returned by
   `access=pending_delete` and by `access=read_only`. A club without the date is returned by
   neither.
5. **Unknown value.** `access=nonsense` through the controller filters nothing.
6. **Combines.** `filter=trialing&access=suspended` returns only trials that are suspended.
7. **Old link.** `filter=pending_delete` still filters.
8. **Permission.** `GET /platform/tenants?access=suspended` as a signed-in club Owner who is not a
   platform operator is refused by `PlatformAdminGuard` (`not_platform_admin`).
9. **Light and dark.** In the browser, each badge reads in both themes and in greyscale, and the
   one-line reason ends in an ellipsis on a narrow window.

### Acceptance criteria

- [ ] 1. `GET /platform/tenants` returns `accessState` on every row, decided in SQL by the precedence in rule 1.
- [ ] 2. The *Acesso* column shows the state as a word with a distinct icon, the *desde* date for read-only, suspended and archived, the one-line reason for a suspended club, and *Dados a apagar em dd-MM-yyyy* when `pending_delete_at` is set.
- [ ] 3. The *Acesso* filter (`access`) filters by state, combines with *Mostrar*, survives sort, search and pagination, and an unknown value filters nothing.
- [ ] 4. *A caminho de eliminação* has moved to *Acesso* as *Dados a apagar*, and `filter=pending_delete` still works.
- [ ] 5. The *Eliminada* chip beside the name is gone.
- [ ] 6. QA 1–8 are integration tests and pass. QA 9 is checked in a browser in both themes.
- [ ] 7. `docs/features/platform.md` describes the column and the filter.
- [ ] 8. `pnpm typecheck`, `i18n:check`, `pt:check`, `contrast:check` and `security:check` are green, and the `poolse-security-review` skill has been run on the diff.
