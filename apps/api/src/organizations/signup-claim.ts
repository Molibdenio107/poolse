import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';

/**
 * What stands between one person and a trial every fifteen days — POOLSE-62.
 *
 * Three things, and only the first refuses anybody:
 *
 *   1. **the address**, which is the ledger's job and happens in SQL — a unique
 *      index on `trial_claim.normalized_email`, written inside the transaction
 *      that makes the tenant;
 *   2. **a disposable domain**, refused here, from a data file;
 *   3. **the IP**, hashed and stored as a *soft flag* that blocks nothing.
 *
 * **A refusal never says which lever was pulled.** "Já usou o seu período
 * experimental" tells an abuser exactly what to change, and the person reading it
 * may be a real customer whose club is coming back — so both refusals point at
 * signing in and at writing to us, and differ in nothing else.
 */

const logger = new Logger('SignupClaim');

/**
 * The salt for the IP hash.
 *
 * **No salt, no hash, no flag** — and that is the honest failure rather than a
 * silent downgrade. An unsalted digest of an IPv4 address is the address with
 * extra steps: the whole space is four billion values and a laptop walks it in
 * minutes, so storing one would be storing the address while claiming not to.
 */
function salt(): string | null {
  const configured = process.env['SIGNUP_IP_SALT'];
  return configured === undefined || configured.trim() === '' ? null : configured;
}

/**
 * An address as a flag, or null.
 *
 * Hex of `sha256(salt + ip)`. The raw value never reaches the database, a log
 * line or an error message; it exists for the length of this function.
 */
export function hashSignupIp(ip: string | null | undefined): string | null {
  const address = typeof ip === 'string' ? ip.trim() : '';
  if (address === '') return null;

  const key = salt();
  if (key === null) return null;

  return createHash('sha256').update(`${key}:${address}`).digest('hex');
}

/**
 * The client's address, from the header the web app forwards.
 *
 * **First entry, not last.** `x-forwarded-for` grows left-to-right as it passes
 * through proxies, so the client is the head and everything after it is
 * infrastructure. Taking the last one flags Vercel, which every signup shares.
 *
 * It is forgeable by anybody holding a session token, and that is *acceptable
 * precisely because it is a soft flag*: defeating it costs an abuser a proxy and
 * gains them nothing the address ledger was not already refusing. A hard block
 * built on a header would be a hard block built on a client's word.
 */
export function clientIpFrom(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return null;

  const first = raw.split(',')[0]?.trim() ?? '';
  return first === '' ? null : first;
}

/**
 * Domains that exist to be thrown away.
 *
 * **A data file, not a list in code** — POOLSE-62 AC 5. Adding one is an edit to
 * a text file that a non-developer can read, review and reason about; the code
 * never names a single domain. `SIGNUP_DISPOSABLE_DOMAINS_FILE` points it
 * somewhere else, so a domain can be added or removed on a running deployment
 * without shipping a build.
 *
 * Read once, lazily. The file is small and the list changes a few times a year;
 * re-reading it per signup would buy nothing but a disk hit on the one request
 * that must not be slow.
 */
let domains: Set<string> | null = null;

function disposableDomains(): Set<string> {
  if (domains !== null) return domains;

  const override = process.env['SIGNUP_DISPOSABLE_DOMAINS_FILE'];
  const path =
    override !== undefined && override.trim() !== ''
      ? override.trim()
      : // `__dirname`, because this API compiles to CommonJS and `import.meta` is
        // a syntax error there. `nest-cli.json` copies every `.txt` under `src`
        // into `dist`, so the file sits beside this module either way.
        join(__dirname, 'disposable-email-domains.txt');

  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    domains = new Set(
      lines
        .map((line) => line.trim().toLowerCase())
        // `#` is a comment, so the file can say *why* a domain is on it.
        .filter((line) => line !== '' && !line.startsWith('#')),
    );
  } catch (error) {
    /*
     * A missing list is not a reason to refuse everybody, and not a reason to
     * crash at boot either. It is logged loudly and signup carries on — the
     * address ledger is the block that matters, and this one is a nuisance
     * filter.
     */
    logger.error(`Could not read the disposable-domain list at ${path}`, error as Error);
    domains = new Set();
  }

  return domains;
}

/** Test seam: forget the cached file so the next read picks a new one up. */
export function forgetDisposableDomains(): void {
  domains = null;
}

/**
 * Is this address one somebody made to last ten minutes?
 *
 * Compared on the bare domain, lowercased. Deliberately *not* on the normalised
 * address: normalisation folds googlemail into gmail and strips tags, which is
 * about identity rather than about the provider, and a list of providers should
 * be readable as exactly what it is.
 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const domain = address.split('@')[1] ?? '';
  if (domain === '') return false;

  return disposableDomains().has(domain);
}
