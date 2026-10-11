import 'server-only';
import { headers } from 'next/headers';
import QRCode from 'qrcode';

/**
 * The public water link as somebody will print it — POOLSE-71.
 *
 * The full URL is this deploy's own origin plus `/agua/<token>`: the origin of
 * the request that rendered the tab, unless `NEXT_PUBLIC_APP_URL` names one —
 * which a deploy behind a proxy that rewrites the host should set.
 *
 * The QR is drawn here, on the server, as a PNG (for the screen and for printing
 * on an office printer) and an SVG (for a sign maker), so the browser bundle
 * carries no encoder. Error correction `M`: a laminated sheet by a wet door gets
 * scuffed.
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env['NEXT_PUBLIC_APP_URL'];
  if (configured) return configured.replace(/\/$/, '');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto =
    h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function publicLinkView(token: string | null): Promise<{
  url: string | null;
  png: string | null;
  svg: string | null;
}> {
  if (token === null) return { url: null, png: null, svg: null };
  const url = `${await appOrigin()}/agua/${token}`;
  const [png, svg] = await Promise.all([
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 1024 }),
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }),
  ]);
  return { url, png, svg };
}
