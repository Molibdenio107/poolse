'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ComponentProps } from 'react';
import { currentHref, stampFrom } from '@/lib/back';

/**
 * The page somebody is on — path, tab, section, page and filters — as the
 * `from` a link should carry. POOLSE-91.
 *
 * Read from the browser's URL rather than built by each page, for two reasons:
 * a server page would have to thread its `searchParams` into every component
 * that draws a link, and `DetailTabs` switches some tabs with `pushState`, so a
 * string the server built would still name the tab the page opened on.
 */
export function useCurrentHref(): string {
  const pathname = usePathname();
  const search = useSearchParams();
  return currentHref(pathname, search ?? new URLSearchParams());
}

/**
 * A `Link` that says where it was followed from, so the page it opens can send
 * Voltar back here — the same tab, section, page and filters (`lib/back.ts`).
 *
 * Every in-app link under `/dashboard` is one of these, bar the few that are
 * themselves a way back (`BackLink`, a wizard's closing button), which stay a
 * plain `Link`. An href outside `/dashboard`, or one that already names its
 * `from`, is passed through untouched.
 */
export function FromLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  return <Link href={stampFrom(href, pathname, search ?? new URLSearchParams())} {...props} />;
}
