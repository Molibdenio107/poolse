import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { Health } from '@/lib/api';

/**
 * `/health`, proxied — for the status strip on `/admin`.
 *
 * **Why a proxy at all.** The strip polls from the browser, and the whole app's
 * rule is browser → Next → API, never browser → API: it keeps the session token
 * out of client JavaScript and means there is no CORS configuration to keep in
 * step across two environments. The API's own `/health` is public, so this one
 * borrows no credentials — but it is still the Next server that reaches it, and
 * `NEXT_PUBLIC_API_URL` may point somewhere the browser cannot see at all.
 *
 * **It requires a session even though the thing it proxies does not.** The API's
 * `/health` is deliberately public, because a platform probe has no token to
 * present. This route exists only to feed a screen, so leaving it open would
 * publish our dependency latencies at a guessable path on the main domain for no
 * benefit. Sign-in is the bar it clears, not platform admin: `/admin` redirects
 * a non-operator anyway, and gating this on the platform flag would mean a
 * second round trip per poll to learn something a signed-in person may know.
 *
 * A failure is a 503 with the same body shape rather than an error page — the
 * strip narrows to "unreachable" and keeps its last reading, which is more
 * useful than a blank.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<Health>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { status: 'down', checks: [] } satisfies Health,
      { status: 401 },
    );
  }

  const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

  try {
    const response = await fetch(`${base}/health`, { cache: 'no-store' });
    // `/health` answers 503 with a body when Postgres is unreachable, which is
    // exactly the reading the strip wants — so the body is read either way and
    // only a thrown fetch counts as unreachable.
    const body = (await response.json()) as Health;
    return NextResponse.json(body, { status: 200 });
  } catch {
    return NextResponse.json(
      { status: 'down', checks: [] } satisfies Health,
      { status: 503 },
    );
  }
}
