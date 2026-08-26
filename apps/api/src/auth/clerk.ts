import { createClerkClient, verifyToken } from '@clerk/backend';

export interface VerifiedSession {
  clerkUserId: string;
  sessionId: string | null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Origins allowed to present a session token to this API.
 *
 * Without this a valid Clerk token minted for some other application on the same
 * instance would authenticate here. Comma-separated so staging and production can
 * each list their own web origin.
 */
function authorizedParties(): string[] {
  const configured =
    process.env['CLERK_AUTHORIZED_PARTIES'] ??
    process.env['WEB_ORIGIN'] ??
    'http://localhost:3000';

  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Verifies a Clerk session token against the instance JWKS.
 *
 * Networked on first use and cached by the SDK afterwards, so this is not a
 * per-request round trip.
 */
export async function verifySessionToken(token: string): Promise<VerifiedSession> {
  const payload = await verifyToken(token, {
    secretKey: requiredEnv('CLERK_SECRET_KEY'),
    authorizedParties: authorizedParties(),
  });

  const clerkUserId = payload.sub;
  if (!clerkUserId) throw new Error('Session token carries no subject');

  return {
    clerkUserId,
    sessionId: typeof payload.sid === 'string' ? payload.sid : null,
  };
}

/**
 * Reads `Authorization: Bearer <token>`. Returns null rather than throwing so the
 * caller decides what a missing token means for that route.
 */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

let client: ReturnType<typeof createClerkClient> | null = null;

/**
 * The Clerk Backend API client, built lazily so that importing this module does
 * not require the secret key to be present (the webhook path and the test suite
 * both import it without one).
 */
export function clerk(): ReturnType<typeof createClerkClient> {
  client ??= createClerkClient({ secretKey: requiredEnv('CLERK_SECRET_KEY') });
  return client;
}
