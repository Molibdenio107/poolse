#!/bin/sh
# The nightly backup, as a Railway cron service — POOLSE-89, moved from GitHub
# Actions on 17-11-2026 because production Postgres has no public network and
# only Railway's private network reaches it.
#
# One run, then exit: Railway starts it on the service's cron schedule and
# skips a night if the last run is still going. In order, stopping at the
# first failure, which emails PLATFORM_ALERT_EMAIL and exits non-zero:
#
#   0. refuse to run with anything that could open a backup in reach;
#   1. backup         — pg_dump over the private network, age-encrypted, uploaded, 30-day prune;
#   2. check-backups  — what was just written is whole (checksum, manifest);
#   3. mirror-files   — the uploads into files/, read and written with two tokens.
#
# The keyless daily check stays on GitHub (backup-check.yml), so a Railway that
# stops running this is noticed from outside it.

set -u
cd "$(dirname "$0")/.." || exit 1

job="cópia de segurança noturna"
link=""
if [ -n "${RAILWAY_PROJECT_ID:-}" ] && [ -n "${RAILWAY_SERVICE_ID:-}" ]; then
  link="https://railway.com/project/${RAILWAY_PROJECT_ID}/service/${RAILWAY_SERVICE_ID}?environmentId=${RAILWAY_ENVIRONMENT_ID:-}"
fi

fail() {
  echo "Backup job FAILED at: $1" >&2
  node --import tsx scripts/backup-alert.ts "$job ($1)" "$link"
  exit 1
}

# 0. Nothing here can open a backup (Rui, 28-10-2026): only the age *public*
# key belongs on Railway. The secret key and SENSITIVE_DATA_KEY live in Rui's
# password manager. Checked by name and by shape; nothing is printed.
for name in BACKUP_AGE_IDENTITY BACKUP_AGE_IDENTITY_FILE SENSITIVE_DATA_KEY; do
  eval "value=\${$name:-}"
  if [ -n "$value" ]; then
    fail "the service holds $name, which must never be on Railway"
  fi
done
if env | grep -q 'AGE-SECRET-KEY-'; then
  fail "an age secret key is in the service's variables"
fi

node --import tsx scripts/backup.ts || fail "backup"
node --import tsx scripts/check-backups.ts || fail "check-backups"
node --import tsx scripts/mirror-files.ts || fail "mirror-files"

echo "Backup job done."
