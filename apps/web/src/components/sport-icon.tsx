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

/** A swimmer in the water, for the swimming rating (Rui, 09-11-2026); the sport's own icon stays *Waves*. */
const Swimmer = createLucideIcon('swimmer', [
  ['circle', { cx: '16.5', cy: '6.5', r: '2', key: 'head' }],
  ['path', { d: 'M3 12 7.5 8.5l4 2.5 3.5-2.5', key: 'stroke' }],
  ['path', { d: 'M2 16c1.7 0 2.3-1.2 4-1.2s2.3 1.2 4 1.2 2.3-1.2 4-1.2 2.3 1.2 4 1.2 2.3-1.2 4-1.2', key: 'w1' }],
  ['path', { d: 'M2 20.5c1.7 0 2.3-1.2 4-1.2s2.3 1.2 4 1.2 2.3-1.2 4-1.2 2.3 1.2 4 1.2 2.3-1.2 4-1.2', key: 'w2' }],
]);

const SoccerBall = createLucideIcon('soccer-ball', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'm12 8.5 3.3 2.4-1.3 3.9h-4l-1.3-3.9z', key: 'patch' }],
  ['path', { d: 'M12 8.5V2.5M15.3 10.9l5.9-1.9M14 14.8l3.5 4.9M10 14.8l-3.5 4.9M8.7 10.9 2.8 9', key: 'seams' }],
]);

const Handball = createLucideIcon('handball', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'M3.5 8.5c5 2.5 12 2.5 17 0M3.5 15.5c5-2.5 12-2.5 17 0', key: 'seams' }],
]);

/**
 * The icon a lesson's rating is drawn in, per sport (Rui, 09-11-2026): *"instead
 * of faces … swimming stroke little icons, for tennis tennis balls, for
 * basketball basketballs"*. Something of the sport itself, counted one to five.
 */
export const RATING_ICON: Record<PoolseSport, LucideIcon> = {
  pool: Swimmer,
  tennis: TennisBall,
  padel: PadelRacket,
  basketball: Basketball,
  football: SoccerBall,
  handball: Handball,
  volleyball: Volleyball,
  gym: Dumbbell,
};

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
