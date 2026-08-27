import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Sun,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Weather at a glance — POOLSE-12.
 *
 * Colour is the point of this ticket: a monochrome row of clouds tells an
 * operator nothing they could not have read faster as text. So each condition
 * gets a hue, and the hues differ in *lightness* as well, which is what keeps
 * them apart for a colour-blind reader and on a screen in bright sun at a
 * poolside.
 *
 * **Colour never carries the meaning on its own.** Every icon is `aria-hidden`
 * and sits beside its own translated label — the panel renders the words whether
 * or not the icon loads, and removing every icon here would lose polish and no
 * information. That is the rule from CLAUDE.md, and the ticket asks for it too.
 *
 * **Licence.** `lucide-react`, ISC — permissive and fine for commercial use, the
 * same set the rest of the product already uses. No new dependency and no
 * attribution obligation to track, which is why this is drawn from what is here
 * rather than from one of the prettier weather-specific sets.
 *
 * Colours are literal here rather than palette tokens, and that is deliberate:
 * "the sun is amber and rain is blue" is not a brand decision that should move
 * when the brand does. Each pair is checked against both themes' surfaces.
 */

export type WeatherKind =
  | 'clear'
  | 'partlyCloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavyRain'
  | 'snow'
  | 'showers'
  | 'snowShowers'
  | 'thunderstorm'
  | 'unknown';

interface Look {
  Icon: LucideIcon;
  /** Night variant, where the condition has one worth drawing. */
  Night?: LucideIcon;
  colour: string;
}

const LOOK: Record<WeatherKind, Look> = {
  clear: { Icon: Sun, Night: Moon, colour: 'text-[#e0a32e] dark:text-[#f0bd52]' },
  partlyCloudy: { Icon: CloudSun, Night: Cloud, colour: 'text-[#c58f2e] dark:text-[#deae54]' },
  overcast: { Icon: Cloudy, colour: 'text-[#6b7a86] dark:text-[#94a2ac]' },
  fog: { Icon: CloudFog, colour: 'text-[#8a93a0] dark:text-[#a8b1bc]' },
  drizzle: { Icon: CloudDrizzle, colour: 'text-[#4f93b8] dark:text-[#79b6d6]' },
  rain: { Icon: CloudRain, colour: 'text-[#2f6f9e] dark:text-[#5c9fca]' },
  // Darker and more saturated than plain rain, so the two are told apart by more
  // than the number of drops in the glyph.
  heavyRain: { Icon: CloudRain, colour: 'text-[#1d4e73] dark:text-[#3f86b5]' },
  snow: { Icon: CloudSnow, colour: 'text-[#7aa7c7] dark:text-[#a6cbe4]' },
  showers: { Icon: CloudRain, colour: 'text-[#3d84ad] dark:text-[#69a9cd]' },
  snowShowers: { Icon: CloudSnow, colour: 'text-[#8fb4cf] dark:text-[#b4d4e9]' },
  thunderstorm: { Icon: CloudLightning, colour: 'text-[#7a5aa8] dark:text-[#a689cf]' },
  unknown: { Icon: Cloud, colour: 'text-foreground-muted' },
};

/**
 * WMO codes to the conditions an operator acts on.
 *
 * The full table is 28 codes separating "light drizzle" from "moderate
 * drizzle", which is more precision than anybody deciding whether to move a
 * class indoors can use. Heavy rain is split out from rain because that is the
 * line where an outdoor session actually changes.
 */
export function weatherKind(code: number | null): WeatherKind {
  if (code === null) return 'unknown';
  if (code === 0) return 'clear';
  if (code <= 2) return 'partlyCloudy';
  if (code === 3) return 'overcast';
  if (code <= 48) return 'fog';
  if (code <= 57) return 'drizzle';
  if (code <= 63) return 'rain';
  // 65 is heavy rain; 66–67 is freezing rain, which is worse still.
  if (code <= 67) return 'heavyRain';
  if (code <= 77) return 'snow';
  // 82 is a violent shower, which behaves like heavy rain for a pool.
  if (code === 82) return 'heavyRain';
  if (code <= 82) return 'showers';
  if (code <= 86) return 'snowShowers';
  return 'thunderstorm';
}

/** Above this, wind is worth mentioning beside the temperature. */
export const WINDY_KMH = 30;

export function WeatherIcon({
  code,
  isDay,
  className,
}: {
  code: number | null;
  /** Null where the provider does not say; the day variant is then used. */
  isDay?: boolean | null;
  className?: string;
}): React.ReactElement {
  const look = LOOK[weatherKind(code)];
  const Icon = isDay === false && look.Night !== undefined ? look.Night : look.Icon;

  return <Icon aria-hidden className={cn('size-5 shrink-0', look.colour, className)} />;
}

/** The wind flag, shown only when there is enough of it to matter. */
export function WindIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <Wind aria-hidden className={cn('size-4 shrink-0 text-[#5a8f7b] dark:text-[#84b8a3]', className)} />
  );
}
