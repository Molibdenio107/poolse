import { Building2, createLucideIcon, Dumbbell, Goal, Hand, Volleyball, Waves, type LucideIcon } from 'lucide-react';
import type { PoolseSport } from '@poolse/rules';
import { cn } from '@/lib/utils';

/*
 * A sport's metadata — POOLSE-141, completed by the handoff's Slice 0. The id is
 * `POOLSE_SPORTS`, the name is `sportNameKey(sport)` in the catalogue (pt-PT
 * and en), and the icon is `SPORT_ICON` below: three facts, one place each, so
 * a chip, a section tab and a sidebar header cannot disagree.
 *
 * Lucide stand-ins for the handoff's Material Symbols (that swap waits until
 * after the pilot). Lucide has no tennis, padel or basketball glyph, so those
 * three are drawn here with `createLucideIcon` — same 24 px box, stroke and
 * `currentColor` as the rest. Padel is the handoff's own SVG (a paddle with
 * three holes; Material has no padel glyph either). Every sport has a glyph of
 * its own: the icon is half the signal beside the name, never the only one.
 */

const TennisBall = createLucideIcon('tennis-ball', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'M5.6 4.3c2.3 2 3.4 4.6 3.4 7.7s-1.1 5.7-3.4 7.7', key: 'seam-l' }],
  ['path', { d: 'M18.4 4.3c-2.3 2-3.4 4.6-3.4 7.7s1.1 5.7 3.4 7.7', key: 'seam-r' }],
]);

/** The handoff's padel glyph (`docs/design/designs/PoolseTopBar.dc.html`). */
const PadelRacket = createLucideIcon('padel-racket', [
  ['circle', { cx: '14.5', cy: '9.5', r: '6', key: 'face' }],
  ['path', { d: 'M10.3 13.7 4.5 19.5', key: 'handle' }],
  ['circle', { cx: '12.6', cy: '8', r: '.8', fill: 'currentColor', stroke: 'none', key: 'h1' }],
  ['circle', { cx: '16.3', cy: '8.6', r: '.8', fill: 'currentColor', stroke: 'none', key: 'h2' }],
  ['circle', { cx: '14.3', cy: '11.7', r: '.8', fill: 'currentColor', stroke: 'none', key: 'h3' }],
]);

const Basketball = createLucideIcon('basketball', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'M12 2v20', key: 'v' }],
  ['path', { d: 'M2 12h20', key: 'h' }],
  ['path', { d: 'M4.9 4.9c1.8 1.8 2.9 4.3 2.9 7.1s-1.1 5.3-2.9 7.1', key: 'l' }],
  ['path', { d: 'M19.1 4.9c-1.8 1.8-2.9 4.3-2.9 7.1s1.1 5.3 2.9 7.1', key: 'r' }],
]);

export const SPORT_ICON: Record<PoolseSport, LucideIcon> = {
  pool: Waves,
  tennis: TennisBall,
  padel: PadelRacket,
  basketball: Basketball,
  football: Goal,
  handball: Hand,
  volleyball: Volleyball,
  gym: Dumbbell,
};

/** The catalogue key of a sport's name — `sport.name.<id>`. */
export function sportNameKey(sport: PoolseSport): `sport.name.${PoolseSport}` {
  return `sport.name.${sport}`;
}

/** Decorative: the sport's name is always written beside it. */
export function SportIcon({ sport, className }: { sport: PoolseSport; className?: string }): React.ReactElement {
  const Icon = SPORT_ICON[sport];
  return <Icon aria-hidden className={cn('size-[19px] shrink-0', className)} />;
}

/** *Instalação*: the site's shared pages, beside the sports. */
export function SiteIcon({ className }: { className?: string }): React.ReactElement {
  return <Building2 aria-hidden className={cn('size-[19px] shrink-0', className)} />;
}
