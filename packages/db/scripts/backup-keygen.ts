import { existsSync, writeFileSync } from 'node:fs';
import { generateIdentity, identityToRecipient } from 'age-encryption';

/**
 * Makes the backups' age key pair — POOLSE-89. Once, by Rui, on his own machine.
 *
 * The secret key is written to the file given (never printed, so it never sits
 * in a terminal's scrollback), and the public key is printed: that one goes to
 * GitHub as BACKUP_AGE_RECIPIENT. The file then goes into the password manager,
 * a second copy goes where the runbook says, and the file is deleted.
 *
 * Run: pnpm --filter @poolse/db backup:keygen <path-for-the-secret-key>
 */

const path = process.argv[2];
if (path === undefined || path.trim() === '') {
  console.error('Give a path for the secret key, e.g. pnpm --filter @poolse/db backup:keygen ~/poolse-backup-key.txt');
  process.exit(1);
}
if (existsSync(path)) {
  console.error(`${path} already exists. A key is never overwritten: a backup made to it would become unopenable.`);
  process.exit(1);
}

const identity = await generateIdentity();
const recipient = await identityToRecipient(identity);
writeFileSync(path, `# Poolse backups — age secret key, made ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`, {
  mode: 0o600,
});
console.log(`Secret key written to ${path}. Put it in the password manager, make the second copy, then delete the file.`);
console.log(`Public key (BACKUP_AGE_RECIPIENT): ${recipient}`);
