import {
  Building2,
  CalendarDays,
  CalendarRange,
  Camera,
  GraduationCap,
  HeartPulse,
  LayoutDashboard,
  TrendingUp,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One icon per kind of thing, from one set.
 *
 * All from `lucide-react`, which ships with shadcn/ui — mixing sets is the
 * fastest way to make an interface look assembled rather than designed, because
 * stroke weights and optical sizes never quite agree.
 *
 * Every icon here is `aria-hidden`. That is not an oversight to fix later: each
 * one sits beside its own text label, and announcing "pool, Piscina Norte" makes
 * a screen reader say everything twice. The rule from CLAUDE.md applies — meaning
 * is never carried by the icon alone, so removing every icon on this screen would
 * lose polish and no information.
 */
const ICONS = {
  dashboard: LayoutDashboard,
  facility: Building2,
  pool: Waves,
  student: GraduationCap,
  class: CalendarDays,
  calendar: CalendarRange,
  people: Users,
  photo: Camera,
  // Backlog round 3, story 9. `HeartPulse` rather than a cross or a pill: the
  // record holds medical notes and consents, not medication, and a red cross
  // reads as an emergency the screen is not reporting.
  progress: TrendingUp,
  medical: HeartPulse,
} satisfies Record<string, LucideIcon>;

export type EntityKind = keyof typeof ICONS;

export function EntityIcon({
  kind,
  className,
}: {
  kind: EntityKind;
  className?: string;
}): React.ReactElement {
  const Icon = ICONS[kind];
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />;
}
