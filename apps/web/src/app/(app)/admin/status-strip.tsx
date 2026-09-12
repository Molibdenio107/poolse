'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleCheck, CircleSlash, Minus, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Health } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Is the server up — the strip across the top of `/admin`.
 *
 * **A client component, and one of very few in this app.** Everything else here
 * renders once on the server; this has to say whether the API is answering *now*,
 * which a server render cannot do without the operator pressing refresh. It
 * polls a route handler on the Next server rather than the API directly, for the
 * reason `lib/api.ts` gives: browser → Next → API, never browser → API, so there
 * is no CORS configuration to keep in step across two environments.
 *
 * **Sixty seconds**, matching the interceptor's flush. Faster would be a request
 * a minute per open tab for a number that changes when something breaks; slower
 * and the strip is stale while somebody is looking at it wondering.
 *
 * **A dot and a word, never a dot alone.** Every dependency renders its name, its
 * state and its latency as text; the colour is how you find the bad one among
 * three, not how you know it is bad.
 */

const TONE: Record<string, { className: string; Icon: LucideIcon }> = {
  ok: { className: 'text-success', Icon: CircleCheck },
  slow: { className: 'text-warning', Icon: TriangleAlert },
  failing: { className: 'text-danger', Icon: CircleSlash },
  // A considered absence, drawn as one. TimescaleDB is deliberately not
  // installed until the hosting question is settled, and a red dot for that is
  // how an operator learns to stop reading the strip.
  not_installed: { className: 'text-foreground-muted', Icon: Minus },
};

const OVERALL: Record<Health['status'], string> = {
  ok: 'bg-success/15 text-success',
  degraded: 'bg-warning/15 text-warning',
  down: 'bg-danger/15 text-danger',
};

const REFRESH_MS = 60_000;

export function StatusStrip(): React.ReactElement {
  const t = useTranslations();

  const [health, setHealth] = useState<Health | null>(null);
  /*
   * `loaded` as its own state rather than inferring it from `health === null`.
   *
   * The standing rule from the stand-in picker: a fetch that answers null for
   * both "not yet" and "it failed" produces a control that is blank with no
   * explanation. Here that would be a strip which silently shows nothing when
   * the API is down — precisely the moment it has something to say.
   */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch('/admin/health', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as Health;
        if (!live) return;
        setHealth(body);
        setFailed(false);
      } catch {
        if (!live) return;
        /*
         * The previous reading is kept rather than blanked. A strip that empties
         * on a dropped packet is a strip that flickers; what changes is the
         * banner, which says plainly that this is the last known state.
         */
        setFailed(true);
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), REFRESH_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (health === null && !failed) {
    // Holds the strip's height, so the table below does not jump when the first
    // reading lands.
    return (
      <section className="h-12 animate-pulse rounded border border-border bg-surface-muted" />
    );
  }

  return (
    <section
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded border border-border bg-surface px-4 py-2.5"
    >
      {health !== null && (
        <span
          className={cn(
            'rounded px-2 py-0.5 text-sm font-medium',
            OVERALL[health.status],
          )}
        >
          {t(`admin.server.${health.status}`)}
        </span>
      )}

      {health?.checks.map((check) => {
        const tone = TONE[check.status] ?? TONE['not_installed']!;
        const { Icon } = tone;

        return (
          <span key={check.name} className="flex items-center gap-1.5 text-sm">
            <Icon className={cn('size-3.5 shrink-0', tone.className)} aria-hidden />
            <span>{t(`admin.dependency.${check.name}`)}</span>
            <span className="text-foreground-muted">
              {check.status === 'not_installed'
                ? t('admin.check.not_installed')
                : t('admin.check.latency', { ms: check.latencyMs ?? 0 })}
            </span>
          </span>
        );
      })}

      {failed && (
        <span className="text-sm text-danger">
          {health === null ? t('admin.server.unreachable') : t('admin.server.stale')}
        </span>
      )}
    </section>
  );
}
