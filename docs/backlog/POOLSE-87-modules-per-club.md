# POOLSE-87 · Modules: switching parts of Poolse on and off per club, from `/admin`

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / Tenancy · **Priority:** High — blocks the pilot preview · **Depends on** POOLSE-63/64 (`changeTenant`, the platform column grants), POOLSE-66 (widget registry) · **Brainstormed** 20-10-2026

### PO — why this exists

The first go-live is the pilot club, and it is **scoped to the teaching operation**: sites and
pools, seasons and levels, turmas, the calendar, students and guardians, enrolment, the register,
closures, people and staff, and fees. The pilot also gets messages, incidents, reception,
competition and water quality. Maintenance, energy, salaries, vacations, qualifications and
invoicing come later (Rui, 20-10-2026).

All of those modules are already built. So the pilot needs a way to **hide modules without
deleting code or data**, and Rui needs a way to switch each one on when the club is ready for it.
That switch is Rui's, on `/admin`. It is a rollout decision, not a club setting.

This is **not pricing**. There is still one plan with every feature, and a trial is still the full
product. A later paid add-on (*Aulas particulares*, *Consultas de nutrição*) may use the same
switch, and that is a later ticket.

**Not in scope:**

- A club-facing settings screen for modules.
- Per-role or per-site modules.
- Per-module pricing.
- Removing any data when a module is switched off.
- A "who owes" list built from fee balances. *Em dívida* is invoice-based and goes away with
  invoicing; a fee-based list is a separate ticket if the pilot asks for it.

### BA — rules and data

**What is always on (core, never switchable):**

- sites and pools (minus water quality)
- seasons, levels and skills
- turmas, sessions and the register
- the calendar, closures, parcerias and bookings
- students, guardians, records, import/export and pre-registration
- people, invitations and staff (minus salaries, vacations and qualifications)
- fees, categories and insurance
- dashboard, profile, subscription, archive and activity, files, support access

**Switchable modules.** This is one list, defined once in `@poolse/rules` as `POOLSE_MODULES`:

| Module | Covers | Pilot |
|---|---|---|
| `messages` | Messages to families, opt-outs | on |
| `incidents` | Incident log, lifeguard roster | on |
| `reception` | Free swim, passes, check-in, occupancy | **Open 1** |
| `competition` | Meets, LENEX import, entry times, gap to qualify | on |
| `water_quality` | Pool analyses and import, ranges, lab results, water threshold, the public water page | on |
| `invoicing` | Faturação: monthly run, documents, series, payments on documents, credit notes, *Em dívida*, reminders | off |
| `maintenance` | Espaços, maintenance tasks and requests, inventory | off |
| `energy` | Meters, readings, tariffs, energy invoices, cost report, weather | off |
| `salaries` | Staff pay, import/export | off |
| `vacations` | Vacations and the team map | off |
| `qualifications` | Staff qualifications and their alerts | off |

The AI dashboards module does not exist yet, so it gets no value now. A module earns its enum value
in the ticket that builds it.

**The rules:**

- **Stored as what is switched off.** An empty list means everything is on. That keeps "a trial is
  the full product" true with nobody remembering to set it, and every signup starts with an empty
  list.
- **Switching off hides and refuses; it never deletes.** Switching back on brings back everything
  exactly as it was.
- **Reversible, so one click.** No `confirmName`, which follows POOLSE-64 E1: only *entering*
  `suspended_at`, `pending_delete_at` or `archived_at` asks for the name.
- **Every change is a platform write.** It is audited before and after by `changeTenant` and raises
  a `platform_alert`, like any other.
- **Dependencies are refused, not resolved.** If module A needs module B, switching B off while A
  is on is refused with both names. Poolse never switches anything off silently. The only
  dependency known today is reception on invoicing (see Open 1).
- **Personal tenants** carry the same column. `kinds` keeps pruning as it does today, and both
  filters apply.

**Open 1 — reception without invoicing.** A free-swim sale is an `invoice_line` (POOLSE-68), and
voiding a pass is a credit note. So reception cannot work with invoicing off. **Recommended
default:** declare `reception` requires `invoicing`. The pilot then starts with reception **off**,
because the club already sells entries on its own certified till and Poolse's documents are
internal records, not faturas. Reception is switched on when POOLSE-76 (certified invoicing) lands.
The alternative is to switch invoicing on for the pilot and accept internal documents next to the
till's.

### Dev — schema, API, where it goes

**Schema (one migration):**

- `create type poolse_module as enum (...)`, matching `POOLSE_MODULES` exactly. A test asserts the
  two lists are equal, so they cannot drift.
- `organization.disabled_modules poolse_module[] not null default '{}'`. Read it `::text[]`, never
  bare (the slice 4.2 lesson).
- A CHECK through an immutable function `modules_consistent(disabled_modules)` refuses a set that
  leaves a module on without its dependency.
- `grant update (disabled_modules) on organization to poolse_platform`. Name it in the platform
  grant list in CLAUDE.md, assert it in `platform-admin.sql`, and confirm the table-wide UPDATE
  revoke still holds (POOLSE-73's rule).
- `poolse_app` gets no write on it. A club cannot switch its own modules.

**API:**

- **The decorator.** `@PoolseModule('energy')` on a controller class, overridable per handler (for
  example, the water routes inside `facilities.controller.ts`). `@CoreRoute()` marks the rest
  explicitly.
- **The check.** A global guard reads the metadata with the Reflector and `currentTenant()`, and
  refuses with **403 `module_disabled`** and the module name. It is not a role guard: roles stay in
  each handler's first line.
- **Boot assertion.** Following the `assertPlatformRoleIsNarrow` pattern, the app **refuses to
  boot** if any tenant route carries neither decorator. This is what stops the first endpoint
  written tired from leaking a hidden module. Public, identity-only, webhook and platform routes
  are exempt by the lists that already name them.
- **The public water page.** `public_water_page()` answers the same 404 as any other miss when the
  club has `water_quality` off. One more condition inside the function, not in the controller.
- **`TenantContext` carries `disabledModules`**, resolved with the membership, so the guard costs
  no query.
- **`/me`** adds `modules` to each membership: the **enabled** list, computed once on the server.
- **Dashboard.** The widget registry gains an optional `module`. `widgetsFor` drops a widget whose
  module is off **before any resolver runs**, the same place roles are applied, asserted on the raw
  JSON. `assertRegistryIsSound` refuses a `module` that is not in `POOLSE_MODULES`. Expected
  mapping (the build confirms each against its resolver's tables):
  - `mgmt.freeswim` → `reception`
  - `mgmt.waterquality.alerts`, `maint.waterquality.due` → `water_quality`
  - `mgmt.maintenance.open`, `maint.mytasks`, `maint.requests`, `maint.cleanings.overdue`,
    `maint.inventory` → `maintenance`
  - `mgmt.energy.costs` → `energy`
  - `mgmt.staffcost` → `salaries`
  - `mgmt.qualifications` → `qualifications`
  - Check `mgmt.money.period` and `me.fees`: if either reads invoices, it splits or takes
    `invoicing`.
- **Crons.** `qualification-alerts` skips clubs with `qualifications` off, and `climate.service`
  skips clubs with `energy` off. `delivery-retry` is left alone: it only resends rows a live module
  already raised. Retention and lead retention are core.
- **Platform endpoint.** `POST /platform/tenants/:id/modules` with body `{ disabled: PoolseModule[] }`
  goes through `changeTenant`. A dependency refusal is a 409 `module_dependency` carrying both names
  as fields, never prose.

**Web:**

- **Sidebar.** `app-sidebar.tsx` gains `modules?: readonly PoolseModule[]` beside `roles` and
  `kinds`, applied to children too: the Staff submenu's salaries, vacations and qualifications;
  Instalações' inventory, incidents and lifeguards; Students' messages and provas; Rececão;
  Faturação; Energia.
- **Site page.** The Espaços, Manutenção and Energia tabs get `visible:` from `/me` modules.
- **Pool page.** The water-quality card follows the module.
- **A page reached by URL with its module off** renders `PageError` with
  `errors.moduleDisabled`: "Este módulo não está ativo para o seu clube." It never shows a blank
  page.
- **`/admin/tenants/[id]`** gets a *Módulos* card with one switch per module and a line under each
  saying what it covers. A refused dependency explains itself through the toast.

**What will be got wrong:**

- A route left untagged. The boot assertion is the answer, not a grep.
- A widget resolver that runs and is then hidden. Filter before resolving.
- A sidebar child that keeps its parent's visibility while its own module is off.
- `poolse_module[]` read without `::text[]`.
- A cron that emails a club about a module it cannot see.
- The `facilities.controller.ts` water routes inheriting the class tag (core) instead of
  `water_quality`.

### Build plan

Three slices, each one ending working:

1. **Schema, platform write and API guard.** The migration, `POOLSE_MODULES`, the decorator, the
   global guard, the boot assertion, tags on every controller, the platform endpoint, and the
   `public_water_page()` condition. QA 1–6 and 10.
2. **What the club sees.** `/me` modules, sidebar pruning, dashboard filtering, site and pool tabs,
   `PageError` for a disabled module, and the two crons. QA 7–9.
3. **`/admin` and docs.** The *Módulos* card, `docs/features/platform.md`, `navigation.md`,
   `dashboard.md`, `docs/data-model.md`, and one CLAUDE.md paragraph. Then set the pilot tenant's
   list.

### QA — test scenarios

1. **Given** a new signup, **then** `disabled_modules` is empty and `/me` lists every module as enabled.
2. **Given** a club with `energy` off, **when** an Owner calls any energy endpoint, **then** 403 `module_disabled` with `module: 'energy'`, and the same for a GET.
3. **Given** a club with `water_quality` off, **when** anyone opens a pool's public water page, **then** the same 404 as an unknown token.
4. **Given** a controller route with no module decorator and no `@CoreRoute()`, **then** the API refuses to boot.
5. **Given** `poolse_app`, **when** it updates `organization.disabled_modules`, **then** permission denied. **Given** `poolse_platform`, **then** it can update that column and still no other column outside its grant.
6. **Given** reception on, **when** the platform switches invoicing off, **then** 409 `module_dependency` naming both, and nothing changes. The CHECK refuses the same set written directly.
7. **Given** `salaries` off, **then** the Owner's dashboard payload has no `mgmt.staffcost` key at all (raw JSON), and the sidebar has no Salaries entry.
8. **Given** `maintenance` off, **then** a maintenance-role user's dashboard has no maintenance band cards, the site page has no Espaços or Manutenção tab, and opening `/dashboard/facilities/inventory` by URL shows the module-disabled message.
9. **Given** `qualifications` off, **when** the daily alert job runs, **then** no `qualification_alert` row is written for that club.
10. **Given** a module switched off and back on, **then** every row created before is visible again unchanged, and `platform_audit_log` holds both changes with before and after.

### Acceptance criteria

1. `organization.disabled_modules` exists. It is empty by default, written only by `poolse_platform` through `changeTenant`, audited, and alerted.
2. `POOLSE_MODULES` in `@poolse/rules` is the one list, equal to the SQL enum by test, with dependencies refused by CHECK and by API.
3. Every tenant route is tagged with a module or as core, enforced at boot; a disabled module's routes answer 403 `module_disabled`.
4. `/me`, the sidebar, the dashboard registry, the site and pool tabs, and the public water page all follow the module list, filtered on the server.
5. Background jobs send nothing about a disabled module.
6. Switching a module off never deletes or alters data.
7. `/admin` has a *Módulos* card; pt-PT and en; docs and CLAUDE.md updated.
8. Open 1 answered and logged in `docs/decisions.md`.
