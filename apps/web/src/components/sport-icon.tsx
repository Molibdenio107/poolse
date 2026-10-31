import { Building2, CircleDot, Dumbbell, Goal, Volleyball, Waves, type LucideIcon } from 'lucide-react';
import type { PoolseSport } from '@poolse/rules';
import { cn } from '@/lib/utils';

/**
 * A sport's icon — POOLSE-141. Lucide stand-ins for the handoff's Material
 * Symbols (that swap waits until after the pilot): waves for the pool, a ball
 * per court sport, a dumbbell for the gym. Decorative: the sport's name is
 * always written beside it, so the icon is never the only cue.
 */
const ICON: Record<PoolseSport, LucideIcon> = {
  pool: Waves,
  tennis: CircleDot,
  padel: CircleDot,
  basketball: CircleDot,
  football: Goal,
  handball: Goal,
  volleyball: Volleyball,
  gym: Dumbbell,
};

export function SportIcon({ sport, className }: { sport: PoolseSport; className?: string }): React.ReactElement {
  const Icon = ICON[sport];
  return <Icon aria-hidden className={cn('size-[19px] shrink-0', className)} />;
}

/** *Instalação*: the site's shared pages, beside the sports. */
export function SiteIcon({ className }: { className?: string }): React.ReactElement {
  return <Building2 aria-hidden className={cn('size-[19px] shrink-0', className)} />;
}
