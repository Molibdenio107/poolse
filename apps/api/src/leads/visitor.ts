import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { clientIpFrom } from '../organizations/signup-claim.js';

/**
 * Who sent a public request — 13-10-2026 sweep.
 *
 * The public form posts from the Next server, so `request.ip` is that server
 * for every parent, and the visitor travels as `x-poolse-client-ip`. The API is
 * public too, so a header anybody can set cannot be believed on its own word:
 * with `WEB_PROXY_SECRET` configured it is believed only beside a matching
 * `x-poolse-proxy-secret`, and a caller without it is counted by its own
 * address. Without the secret (a dev machine) the header is believed as before;
 * production without it is a go-live item, and the API says so at boot.
 */
export function visitorOf(request: Pick<Request, 'headers' | 'ip'>): string {
  const forwarded = clientIpFrom(request.headers['x-poolse-client-ip']);
  const secret = process.env['WEB_PROXY_SECRET'];

  if (forwarded !== null && (secret === undefined || secret === '' || proxyIsTrusted(request, secret))) {
    return `client:${forwarded}`;
  }
  return `ip:${request.ip ?? 'unknown'}`;
}

function proxyIsTrusted(request: Pick<Request, 'headers'>, secret: string): boolean {
  const given = request.headers['x-poolse-proxy-secret'];
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
