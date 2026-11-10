'use client';

import { useEffect } from 'react';

/**
 * Sends the reader on from Início, with a full page load.
 *
 * Sign-in lands on Início, and the next in-app navigation after Clerk's own
 * never commits: a server `redirect()` and a `router.replace` both fetched
 * `/dashboard` and left the address and a blank page behind (walk, 10-11-2026).
 * A full load of `/dashboard` always works, and its server then sends a family
 * or a teacher's phone on as it always has. One reload, once, at sign-in, for
 * the logins that are not Owner or Admin.
 */
export function LandOn({ href }: { href: string }): null {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return null;
}
