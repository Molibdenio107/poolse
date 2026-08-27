---
name: write-migration
description: Write, review or run a PostgreSQL migration for Poolse. Use this whenever a change touches the database — a new table or column, an enum value, an index, a constraint, a trigger, an RLS policy, a SECURITY DEFINER function, or anything under packages/db/migrations. Also use when reviewing a migration someone else wrote, when a migration fails to apply, or when the tenant-isolation test starts failing after a schema change. Poolse's isolation guarantees live in the schema rather than in application code, so a migration written without these rules silently weakens them — always consult this skill before writing SQL.
---

# Writing a Poolse migration

Poolse's tenant isolation is a property of the **schema**, not of the repository layer. A
migration that forgets a policy or a composite key does not fail loudly — it quietly opens
a path between tenants that nothing will notice until a customer sees another customer's
data. That is why this checklist exists and why it is worth following even when the change
looks trivial.

## Before writing anything

**Never edit a migration that has been applied.** Anything already run against staging or
production is history. Changes go in a new file. Editing an applied file leaves databases
in states that no longer match any file on disk, and the drift is invisible until something
breaks in a way nobody can reproduce.

New file: `packages/db/migrations/<epoch-ms>_<kebab-name>.sql`, with both markers:

```sql
-- Up Migration
...
-- Down Migration
...
```

The runner splits on those markers, applies each migration in a single transaction, and
records it in `schema_migration`. A migration without a working Down section cannot be
rolled back — write it, and make it actually reverse the Up.

## Every tenant-scoped table

Work through all of these. Missing one is the usual cause of a subtle bug.

1. **`organization_id uuid NOT NULL`** referencing `organization (id)`.
2. **`UNIQUE (organization_id, id)`** if any other table will reference this one — this is
   what makes composite foreign keys possible, and it must exist before the child table.
3. **Composite foreign keys to tenant-scoped parents**, never a bare `id` reference:
   ```sql
   FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id)
   ```
   Without this, a row in org A can reference a row in org B. RLS will not catch it —
   both rows pass their own policies. Only the composite key prevents it.
4. **`created_at` / `updated_at timestamptz NOT NULL DEFAULT now()`**, plus the trigger:
   ```sql
   CREATE TRIGGER <table>_updated_at BEFORE UPDATE ON <table>
     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
   ```
5. **`archived_at timestamptz`** for anything an operator can see. Soft delete, not `DELETE`.
6. **Enable RLS and add the policy:**
   ```sql
   ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY <table>_tenant ON <table>
     USING (organization_id = current_organization_id())
     WITH CHECK (organization_id = current_organization_id());
   ```
   `USING` governs reads and which rows can be changed; `WITH CHECK` governs what may be
   written. Both are needed — `USING` alone lets a row be written into another tenant.
7. **Grants**, if the table is created outside the default-privileges path:
   `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO poolse_app;`

## Constraint rules that are easy to get wrong

**Every unique constraint on a soft-deletable table must be partial.**

```sql
CREATE UNIQUE INDEX <name>_uq ON <table> (organization_id, <col>)
  WHERE archived_at IS NULL;
```

A plain unique constraint collides with archived rows: archive an instructor, try to re-add
the same person next season, and the insert fails against a row nobody can see.

**Overlap constraints use `EXCLUDE`, not application checks.** Two classes cannot occupy the
same pool and lane at once; let the database say so:

```sql
EXCLUDE USING gist (pool_id WITH =, lane WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status <> 'cancelled' AND lane IS NOT NULL)
```

Requires the `btree_gist` extension.

**Enum or lookup table?** A Postgres enum where the set is genuinely closed and only a
developer changes it (payment status, membership status). A lookup table where an operator
might add values (student level, task type) — adding an enum value is a migration, and
customers cannot wait for a deploy to create a new class level.

## Column type rules

| Kind | Type | Why |
|---|---|---|
| Money amounts | `amount_cents integer` + `currency char(3)` | Never float |
| Unit prices | `numeric(12,6)` | €0.1548/kWh rounds to €0.15 in cents — a 3% error in the module whose purpose is cost accuracy |
| Readings | `numeric(10,3)` + explicit `unit` | pH, °C, ppm and kWh do not share a type |
| Times | `timestamptz`, stored UTC | Displayed in the facility's timezone |
| Durations, race times | integer milliseconds | Never float |
| Coordinates | `numeric(9,6)` | |

## The two special cases

**SECURITY DEFINER — only for organization provisioning.** Creating a new organization
cannot pass the RLS `WITH CHECK` on `organization`, because a brand-new org is not the
current org. The sanctioned fix is the existing `provision_organization` function:

```sql
CREATE FUNCTION ... RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp   -- required hardening; omitting it is a real vulnerability
AS $fn$ ... $fn$;

REVOKE ALL ON FUNCTION ... FROM public;
GRANT EXECUTE ON FUNCTION ... TO poolse_app;
```

If a second `SECURITY DEFINER` function seems necessary, stop and reconsider — that is
almost always a sign the problem is somewhere else. Never weaken an RLS policy or point the
app at the owner role to make something work.

**TimescaleDB hypertables take no surrogate `id`.** Timescale requires the partitioning
column in every unique index, so a `uuid PRIMARY KEY` makes the table unconvertible. Use a
natural composite key:

```sql
PRIMARY KEY (organization_id, meter_id, taken_at)
```

This applies to `energy_reading`, and to `reading` once sensor feeds exist.

## Always finish here

```bash
pnpm db:migrate
pnpm db:test
```

**The tenant-isolation assertions must all still pass.** If a schema change broke one, the
change is the bug — not the test. It proves, against a real database, that an unscoped
`SELECT` returns only the current tenant, that a cross-tenant write is refused, and that a
composite key blocks a cross-tenant reference.

Then check the Down migration actually works:

```bash
pnpm --filter @poolse/db migrate:down
pnpm db:migrate
```

**Add an assertion when you add an isolation-relevant table.** A new tenant-scoped table
with a policy nobody tests is a policy that may not work. One more block in
`packages/db/test/tenant-isolation.sql` costs a few minutes and keeps the guarantee real.

## Update the documentation in the same commit

`docs/data-model.md` is the schema's description. A migration that changes the schema
without changing that file leaves the next session working from a document that is now
wrong — and every future session reads it. Update it as part of the change, not afterwards.