import 'server-only';

/**
 * The opt-out link's page — POOLSE-86, 3.0c. No login: the token is the key,
 * and the API answers every kind of miss with the same 404.
 */
export interface PublicEmailPreference {
  clubName: string;
  locale: string;
  optedOut: boolean;
}

function baseUrl(): string {
  return process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
}

/** The choice, or null for every kind of miss. */
export async function fetchEmailPreference(token: string): Promise<PublicEmailPreference | null> {
  const response = await fetch(`${baseUrl()}/public/email/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Email preference: HTTP ${response.status}`);
  return (await response.json()) as PublicEmailPreference;
}

export async function saveEmailPreference(token: string, optedOut: boolean): Promise<PublicEmailPreference | null> {
  const response = await fetch(`${baseUrl()}/public/email/${encodeURIComponent(token)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ optedOut }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Email preference: HTTP ${response.status}`);
  return (await response.json()) as PublicEmailPreference;
}
