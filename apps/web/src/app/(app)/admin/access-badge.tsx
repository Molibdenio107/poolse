'use client';

import { useTranslations } from 'next-intl';
import { Archive, CircleCheck, CircleHelp, Eye, Lock, Trash2, type LucideIcon } from 'lucide-react';
import type { PlatformAccessState, PlatformTenant } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';

/**
 * Whether a club's door is open — POOLSE-226.
 *
 * The chip beside *Subscrição*, which says what a club pays; this says whether
 * anybody can get in. **An icon per state as well as a word**, like
 * `SubscriptionBadge`: the column reads in greyscale, and the colour only helps
 * the eye find the shut ones among many. Full class names, never interpolated
 * (Tailwind scans the source as text).
 */
const TONE: Record<PlatformAccessState, { className: string; Icon: LucideIcon }> = {
  active: { className: 'bg-success/15 text-success', Icon: CircleCheck },
  read_only: { className: 'bg-warning/15 text-warning', Icon: Eye },
  suspended: { className: 'bg-danger/15 text-danger', Icon: Lock },
  archived: { className: 'bg-surface-muted text-foreground-muted', Icon: Archive },
};

const FALLBACK = { className: 'bg-surface-muted text-foreground-muted', Icon: CircleHelp };

/** Since when the state holds; `active` has no date of its own. */
function since(tenant: PlatformTenant): string | null {
  switch (tenant.accessState) {
    case 'archived':
      return tenant.archivedAt;
    case 'suspended':
      return tenant.suspendedAt;
    case 'read_only':
      return tenant.readOnlyAt;
    default:
      return null;
  }
}

export function AccessCell({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const state = tenant.accessState;
  const tone = TONE[state] ?? FALLBACK;
  const { Icon } = tone;
  const known = state in TONE;
  const from = since(tenant);

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-sm',
          tone.className,
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {known ? t(`admin.access.${state}`) : state}
      </span>

      {from !== null && (
        <span className="text-xs text-foreground-muted">
          {t('admin.access.since', { date: formatDate(new Date(from)) })}
        </span>
      )}

      {/*
        The reason, cut to one line and visibly so; the club's page quotes it in
        full. Never a tooltip: what the operator needs is text on the screen.
      */}
      {state === 'suspended' && tenant.suspensionReason !== null && (
        <span className="block max-w-56 truncate text-xs text-foreground-muted">
          {tenant.suspensionReason}
        </span>
      )}

      {/* A deletion date cuts across every state, so it is its own line. */}
      {tenant.pendingDeleteAt !== null && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
          <Trash2 className="size-3.5 shrink-0" aria-hidden />
          {t('admin.access.pendingDelete', { date: formatDate(new Date(tenant.pendingDeleteAt)) })}
        </span>
      )}
    </div>
  );
}
