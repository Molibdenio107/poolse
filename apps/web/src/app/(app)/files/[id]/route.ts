import { apiFileResponse } from '@/lib/api';

/**
 * A stored file, streamed through the app — 12 October 2026.
 *
 * The bucket is private and nothing hands out a link that works without a
 * session: this route asks the API, which applies the file purpose's read rule
 * on every request, and passes the bytes (or the refusal) straight on. Same
 * origin, so `img-src 'self'` covers every photograph and no CSP line was added.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });

  const upstream = await apiFileResponse(`/files/${id}`);
  if (!upstream.ok || upstream.body === null) {
    return new Response(null, { status: upstream.status === 403 ? 403 : 404 });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Never kept, not even by the browser: a shared reception computer must not
  // reopen an atestado or an ID photo after its reader signed out (13-11-2026).
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(upstream.body, { status: 200, headers });
}
