import { randomBytes } from 'node:crypto';
import { withOrg, withoutTenantScope, type Tx } from '@poolse/db';

/**
 * Opting out of a club's general messages — POOLSE-86, slice 3.0c.
 *
 * One `email_preference` row per (club, address): the token behind the link
 * that every opt-out-able email carries, and whether messages are wanted. Only
 * general club messages read it (Rui, 19-10-2026) — `message_recipients()`
 * marks an opted-out address, and a closure warning ignores the mark.
 */

export interface PublicEmailPreference {
  clubName: string;
  locale: string;
  optedOut: boolean;
}

function webLink(path: string): string {
  const origin = (process.env['WEB_ORIGIN'] ?? 'http://localhost:3000').split(',')[0]!.trim();
  return `${origin.replace(/\/$/, '')}${path}`;
}

/** The address's token in this club, made the first time it is needed. Inside the club's own transaction. */
export async function tokenFor(tx: Tx, organizationId: string, email: string): Promise<string> {
  await tx.query(
    `INSERT INTO email_preference (organization_id, email, token) VALUES ($1, $2::citext, $3)
     ON CONFLICT (organization_id, email) DO NOTHING`,
    [organizationId, email, randomBytes(32).toString('base64url')],
  );
  const { rows } = await tx.query<{ token: string }>(
    'SELECT token FROM email_preference WHERE organization_id = $1 AND email = $2::citext',
    [organizationId, email],
  );
  return rows[0]!.token;
}

/** The opt-out page for a token — the link a general message's footer carries. */
export function optOutUrl(token: string): string {
  return webLink(`/email/${token}`);
}

/** The signed-in member's own choice in this club, for their profile. */
export async function readOwnPreference(
  organizationId: string,
  email: string,
): Promise<{ email: string; optedOut: boolean }> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ opted_out: boolean }>(
      `SELECT messages_opted_out_at IS NOT NULL AS opted_out FROM email_preference
        WHERE organization_id = $1 AND email = $2::citext`,
      [organizationId, email],
    );
    return { email, optedOut: rows[0]?.opted_out ?? false };
  });
}

export async function setOwnPreference(
  organizationId: string,
  email: string,
  optedOut: boolean,
): Promise<{ email: string; optedOut: boolean }> {
  await withOrg(organizationId, async (tx) => {
    await tokenFor(tx, organizationId, email);
    await tx.query(
      `UPDATE email_preference
          SET messages_opted_out_at = CASE WHEN $3 THEN coalesce(messages_opted_out_at, now()) ELSE NULL END
        WHERE organization_id = $1 AND email = $2::citext`,
      [organizationId, email, optedOut],
    );
  });
  return readOwnPreference(organizationId, email);
}

/** By the link: no tenant and no login, through the token's own definer functions. */
export async function readByToken(token: string): Promise<PublicEmailPreference | null> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ page: PublicEmailPreference | null }>(
      'SELECT public_email_preference($1) AS page',
      [token],
    );
    return rows[0]?.page ?? null;
  });
}

export async function setByToken(token: string, optedOut: boolean): Promise<PublicEmailPreference | null> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ page: PublicEmailPreference | null }>(
      'SELECT set_public_email_preference($1, $2) AS page',
      [token, optedOut],
    );
    return rows[0]?.page ?? null;
  });
}
