# Security — what holds it up, and what is still open

Written after a full review of the app on 5 September 2026. This is the standing
note: what is structurally guaranteed, what a check enforces, and what is
knowingly left. It is not a list of things to feel good about — the last section
is the useful one.

## What guarantees what

Isolation and injection are not held up by anybody remembering a rule. Each one
has a mechanism, and the mechanism is what to check when something looks wrong.

| Concern | What actually prevents it |
|---|---|
| SQL injection | Every query is parameterised. No request value is ever interpolated into SQL — the only `${}` inside a query template are code constants (a table alias, a bind placeholder). `pnpm sql:check` guards the template literals. |
| Search-term injection | `searchPredicate` uses `strpos`, not `LIKE`. A predicate with no pattern language cannot be handed a pattern, so `%` and `_` are letters. |
| Cross-tenant reads | Row-level security keyed on a per-request GUC, plus composite foreign keys. The app connects as `poolse_app`, which owns nothing, and `assertRlsApplies()` refuses to boot if that ever changes. |
| A client naming its own tenant | `TenantMiddleware` derives the organization from the verified session and confirms it against a membership row. The `x-poolse-organization` header is a *request* for an org, never an assertion of one. |
| An unprotected new endpoint | Default-deny: auth and tenancy middleware apply to `*` and public routes are excluded one at a time. |
| Privilege escalation | `requireRole` server-side on every mutation. Hiding a control is never the control. |
| Webhook forgery | svix signature verification over the raw request bytes. |
| Medical notes at rest | AES-256-GCM with a random IV per record. The app refuses to start without `SENSITIVE_DATA_KEY`, so there is no code path that stores them in the clear. |
| Invitation tokens | 32 random bytes, stored only as a SHA-256 hash, and the redemption routes are rate limited to 10/minute. |
| CSV formula execution | `lib/csv.ts` is the only place a CSV cell is written. `pnpm csv:check` fails the build if a second one appears. |
| Request floods from an account | `UserThrottlerGuard`, 300/minute, keyed on the Clerk user rather than the IP. |

## The checks

`pnpm security:check` runs the three that are cheap enough to run every time:

- `sql:check` — no backtick can truncate a SQL template literal.
- `csv:check` — nothing writes a CSV except `lib/csv.ts`.
- `audit:check` — `pnpm audit --audit-level high`. Set at `high` on purpose: it
  is a gate that means "stop and deal with this tonight", and a gate that is red
  every day is a gate people stop reading. The moderates below are tracked here
  instead.

`pnpm db:test` is the one that proves isolation — it includes a cross-tenant
visibility test per module, and those are the tests to distrust a schema change
against.

## Still open, knowingly

Six moderate advisories remain. Every one needs a **major** version bump, which
is a migration with its own testing rather than a line in a lockfile, so each is
its own slice. None is reachable from a request today; the reachability note is
the reason each can wait, not a reason to skip it.

| Package | Path | Needs | Reachable today? |
|---|---|---|---|
| `next-intl` 3.26.5 | direct, web | ≥4.9.2 | The i18n layer is the most load-bearing convention in the app; a 3→4 migration wants a session of its own. |
| `@nestjs/core` 10.4 | direct, api | ≥11.1.18 | Nest 10→11 across every controller. Schedule deliberately. |
| `file-type` 20.4.1 | via `@nestjs/common` | ≥21.3.2 | Not reachable: nothing in the API accepts a file upload. Revisit the day file storage lands. |
| `uuid` 8.3.2 | via `exceljs` | ≥11.1.1 | Build-time of a workbook only. Forcing v11 breaks exceljs, which still calls the v8 API — this one waits for exceljs, not for us. |

The `pnpm.overrides` block in the root `package.json` pins the transitive
packages that *could* be fixed without a major: `qs`, `body-parser`, `postcss`,
`glob`, `picomatch`, `multer`, `webpack`, `ajv`, `tmp`. Each is a patch or minor
move within the major the tree already resolved. Delete an entry when the
dependency that pulled it in catches up.

### Two limits worth knowing

**Unauthenticated floods are not counted.** Nest runs middleware before guards,
so a flood carrying a bad token is refused by `ClerkAuthMiddleware` before the
throttler sees it. Those requests are rejected but not counted. That is the right
trade at this size — Clerk verifies against a cached JWKS with no network call —
and the fix, if it ever stops being true, is a throttle *middleware* registered
ahead of the auth one.

**The script half of the CSP is report-only.** Enforcing `script-src` properly
needs a per-request nonce, and a nonce ends static prerendering — which would
undo the decision `theme-script.tsx` exists to protect. The policy ships watching
rather than blocking: violations show in the browser console, and once real use
has produced none for a while, the same string moves to the enforcing header. The
directives that cannot break a page — `frame-ancestors`, `object-src`,
`base-uri`, `form-action` — are enforced now.

## If something looks wrong

- A page 500s or the styling breaks mid-session → almost always `pnpm build`
  having been run while `pnpm dev` was up, not a code defect. Check the dev log
  for `Cannot find module`.
- A signed-out `curl` of a protected route returns 404 → that is Clerk rewriting
  the request, not a broken route tree.
- The tenant isolation tests fail after a schema change → read the `write-migration`
  skill before touching the migration; the guarantee lives in the schema.
