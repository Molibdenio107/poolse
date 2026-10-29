import 'server-only';
import type { InvitationPreview } from './api';

/**
 * An invitation's preview, with no session — 29-10-2026. The page is public so
 * a person reads what they are being offered before making an account; the
 * token is the only key and the API answers every miss as a status.
 */
function baseUrl(): string {
  return process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
}

export async function fetchInvitationPreview(token: string): Promise<InvitationPreview> {
  const response = await fetch(`${baseUrl()}/join/preview?token=${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Invitation preview: HTTP ${response.status}`);
  return (await response.json()) as InvitationPreview;
}
