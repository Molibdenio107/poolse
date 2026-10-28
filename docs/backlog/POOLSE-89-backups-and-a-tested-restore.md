# POOLSE-89 · Backups, and a restore that is proved rather than hoped for

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Operations · **Area:** Platform / Data · **Priority:** High — blocks the pilot preview · **Depends on** nothing in code; the production database (0.10) to switch it on · **Written** 21-10-2026

> **Built 28-10-2026**, with two changes from this text (`docs/decisions.md`). The drill runs on
> Rui's machine (`restore-drill`), because it needs keys that are never in GitHub; GitHub runs the
> backup and a daily keyless check. `age` is the `age-encryption` npm package (the same format),
> and the Postgres tools come from the `postgres:<major>` image. The runbook is in `docs/deploy.md`.

### PO — why this exists

The pilot preview runs on production, because the club enters real children's names, guardians'
NIFs and health notes (decision of 20-10-2026). That decision named backups with a *tested
restore* as a precondition. Nothing for either exists today.

A backup nobody has restored is a file of unknown worth. So this ticket's real deliverable is
the drill: a restore that runs on a schedule, into a scratch database, and fails loudly when
the backup could not bring the club back.

**Not in scope:**
- Point-in-time recovery or WAL archiving. A nightly dump loses at most one day. For a club
  that keeps its spreadsheets until go-live, that is the right trade at €0.
- A restore button in `/admin`. Restoring production is a deliberate human act, done from the
  runbook.
- Backing up R2 files (photos, documents). That is a follow-up once uploads are switched on
  for real.
- Paid backup products.

### BA — rules

- **One encrypted dump of the whole database every night.** It is a custom-format `pg_dump`
  of the production database as the owner login, compressed, then encrypted to a public key.
  It never leaves the job in plaintext, because the medical notes are already ciphertext but
  the names, NIFs, addresses and minors' records are not.
- **The key that opens it is never stored beside it.** The private key, and
  `SENSITIVE_DATA_KEY` that decrypts the medical notes, live with Rui offline, for example in
  a password manager. A stolen bucket is then unreadable, and a restore needs both keys and
  the person who holds them.
- **Where it goes:** a private R2 bucket of its own (`poolse-backups-<env>`), separate from the
  uploads bucket, with a token that can write to that bucket and do nothing else.
- **How long it is kept: 30 daily copies and nothing older** (Rui, 21-10-2026). This matters beyond storage. 7b.8 erases a departed student's health data after
  one year, and a backup still holds it until the backup expires. So the backup retention is
  the time it takes an erasure to become complete, and the privacy notice has to say so.
- **The drill:** every week, and on demand, the latest backup is downloaded, decrypted and
  restored into an empty Postgres. It must then prove five things:
  1. Every migration in the repo is recorded as applied.
  2. Each tenant table's row count matches the manifest the backup job wrote.
  3. RLS is still enabled on every table in `TENANT_TABLES`.
  4. The `poolse_app` and `poolse_platform` grants are in place.
  5. One medical note decrypts with the key held offline.

  A failure is an email to `PLATFORM_ALERT_EMAIL` and a red run.
- **Roles are created by the restore, not carried in the dump.** `pg_dump` of one database
  does not include cluster roles. The runbook creates `poolse_app` and `poolse_platform`, with
  new passwords, before restoring with `--no-owner`. The drill does the same, which proves
  the runbook.

### Dev — where it goes

- **Where the job runs: GitHub Actions on a schedule** (Rui, 21-10-2026):
  `.github/workflows/backup.yml` nightly, and `restore-drill.yml` weekly.
  - It is free at this size, and the database credential then lives in GitHub's secrets
    rather than in an application that faces the internet. The API's login cannot dump
    everything anyway: it is `poolse_app`, under RLS.
  - A Railway cron service beside the API was the alternative and was declined: it is a
    second paid process, and its secrets would sit beside the app's.
- **Scripts under `packages/db/scripts/`:**
  - `backup.ts`: `pg_dump`, then a manifest of row counts, then `age` encryption, then upload.
  - `restore.ts`: download, decrypt, create the roles, then `pg_restore`.
  - `verify-restore.ts`: the five proofs above.

  All three run locally against the Docker database exactly as they do in CI, so the drill is
  testable today, before production exists.
- **Encryption:** `age`, which is a single binary and has one key format. The public key is a
  repo secret; the private key is never in GitHub.
- **Things most likely to go wrong:**
  - A dump that "succeeded" but is empty or truncated. The manifest's row counts are the check.
  - A restore that works only on the machine that wrote it, because of roles, extensions or
    the TimescaleDB question in `docs/deploy.md`. The drill restores into a clean, stock
    Postgres container.
  - The private key existing only on the laptop that made it. The runbook says where its
    second copy lives.
  - A backup job that has silently stopped. A missing night is itself an alert: the drill
    checks the newest object's age.
- **Docs:**
  - `docs/deploy.md` gains a *Backups and restoring* runbook, and checklist lines for the
    bucket, the token, the age key and the secrets.
  - `docs/decisions.md` records where the job runs and the retention.
  - `docs/features/retention.md` says that an erasure completes when the oldest backup
    holding it expires.

### QA — test scenarios

1. **Given** the dev database with the reference seed, **when** `backup.ts` runs, **then** an encrypted object and its manifest are in the bucket (S3Mock locally), and the object does not open without the private key.
2. **Given** that backup, **when** `restore.ts` runs into an empty Postgres container, **then** `verify-restore.ts` passes all five proofs.
3. **Given** a backup whose dump was truncated (the test cuts the file), **then** the restore or the verification fails, and the failure names what was missing. It never reports a green run.
4. **Given** a tenant table added to `TENANT_TABLES` but missing from the restored database, **then** the RLS proof fails and names the table.
5. **Given** the wrong `SENSITIVE_DATA_KEY`, **then** the decryption proof fails. This is the case "we have the data and cannot read the medical notes".
6. **Given** the newest backup is older than 36 hours, **then** the drill fails with "no backup since <date>" and alerts.
7. **Given** the bucket token, **then** it cannot read or delete the uploads bucket. This is tested against S3Mock's policy, or recorded by hand on R2.

### Acceptance criteria

1. A nightly job writes an encrypted, manifest-checked dump to its own private bucket; the decryption key is not in the bucket, the repo or GitHub.
2. A weekly drill restores the newest backup into a clean Postgres and proves the five checks, alerting on failure or on a stale backup.
3. Both run locally against Docker with the same scripts, and QA 1–6 pass there.
4. `docs/deploy.md` has a runbook a tired person can follow to restore production into a new database, and the checklist lists what Rui must create.
5. The retention is decided and written down where the privacy notice can quote it.
