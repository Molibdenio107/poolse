import 'server-only';

/**
 * The public sign-up form's two calls — POOLSE-69.
 *
 * Not `apiFetch`: that refuses without a Clerk session, and the parent filling
 * this in has none. Like `public-water.ts`, a plain fetch to the API's
 * `public/` routes, which run outside Clerk and outside any tenant.
 */

export interface RegistrationForm {
  form: {
    clubName: string;
    /** Under this a swimmer needs a guardian — the club's own setting. */
    ageOfMajority: number;
    /** Where a complaint goes — POOLSE-73. */
    complaints: { regime: 'private' | 'public_service'; url: string };
    /** Each site's operating regulation in force. */
    regulations: { facilityName: string; effectiveFrom: string; body: string }[];
    facilities: { id: string; name: string }[];
    levels: { id: string; name: string }[];
  };
  /** Proof the form was rendered recently; handed back on submit. */
  stamp: string;
  consentVersion: string;
}

function baseUrl(): string {
  return process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
}

/** The form, or null — an unknown slug and a club that has not opened it are alike. */
export async function fetchRegistrationForm(slug: string): Promise<RegistrationForm | null> {
  const response = await fetch(
    `${baseUrl()}/public/clubs/${encodeURIComponent(slug)}/registration`,
    { cache: 'no-store', headers: { accept: 'application/json' } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registration form: HTTP ${response.status}`);
  return (await response.json()) as RegistrationForm;
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; fields: Record<string, string> }
  | { ok: false; failed: true };

/**
 * Sends a sign-up. The API answers 202 to everything shaped like one — known
 * club or not — and 400 only for a body it could not read, naming the fields.
 * `clientIp` is the visitor, forwarded the way signup does, because the API
 * otherwise sees this server for every parent.
 */
export async function postRegistration(
  slug: string,
  body: Record<string, unknown>,
  clientIp: string | null,
): Promise<SubmitResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (clientIp) headers['x-poolse-client-ip'] = clientIp;
  // What makes the API believe the address above — `leads/visitor.ts`. A
  // server-side variable, never NEXT_PUBLIC_: it is a secret between two servers.
  const proxySecret = process.env['WEB_PROXY_SECRET'];
  if (proxySecret) headers['x-poolse-proxy-secret'] = proxySecret;

  const response = await fetch(
    `${baseUrl()}/public/clubs/${encodeURIComponent(slug)}/registration`,
    { method: 'POST', cache: 'no-store', headers, body: JSON.stringify(body) },
  );
  if (response.status === 202) return { ok: true };
  if (response.status === 400) {
    const parsed = (await response.json().catch(() => ({}))) as { fields?: Record<string, string> };
    // A 400 that names no field (a body the API could not read) has nothing to
    // mark beside a box, so it is a failure the page says out loud.
    if (parsed.fields === undefined || Object.keys(parsed.fields).length === 0) {
      return { ok: false, failed: true };
    }
    return { ok: false, fields: parsed.fields };
  }
  return { ok: false, failed: true };
}
