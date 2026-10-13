import 'server-only';

/**
 * The public water page's one request — POOLSE-71.
 *
 * Not `apiFetch`: that refuses without a Clerk session, and the people reading
 * this page have none. No token, no organization header, nothing but the link's
 * own token in the path. `no-store`, so switching the page off or replacing its
 * link takes effect on the next load rather than after a cache expires.
 */

export type PublicReadingState = 'inside' | 'low' | 'high' | 'unjudged';

export interface PublicReading {
  metric: string;
  value: number;
  unit: string;
  takenAt: string;
  band: { from: number | null; to: number | null } | null;
  state: PublicReadingState;
  stale: boolean;
}

export interface PublicWater {
  facilityName: string;
  poolName: string;
  timezone: string;
  readings: PublicReading[];
  /** The latest laboratory grade and the day it was sampled — POOLSE-72. */
  lab: { grade: 'conforme' | 'conforme_condicionada' | 'nao_conforme'; sampledAt: string } | null;
  /** Where a complaint goes — POOLSE-73. */
  complaints: { regime: 'private' | 'public_service'; url: string };
  /** The facility's operating regulation in force, or null. */
  regulation: { effectiveFrom: string; body: string } | null;
}

function baseUrl(): string {
  return process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
}

/** The page, or null for every kind of miss — the API answers them all alike. */
export async function fetchPublicWater(token: string): Promise<PublicWater | null> {
  const response = await fetch(`${baseUrl()}/public/water/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Public water page: HTTP ${response.status}`);
  return (await response.json()) as PublicWater;
}
