import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The one way a person is ever pictured in Poolse.
 *
 * Every list, roster, weekly grid and detail view renders people through this,
 * and that is the point rather than tidiness: a student's photograph may only be
 * shown where a `photo` consent record is granted and not withdrawn, and a rule
 * enforced in one component cannot be forgotten at the twelfth place a student
 * appears. `photoUrl` is deliberately the *only* way to pass a picture in, so a
 * caller that has not resolved consent has nothing to pass.
 *
 * With no photograph the fallback is initials on a tinted background, not a grey
 * silhouette. Initials read as designed; a silhouette reads as broken, and most
 * of this product will show people with no photograph for a long time.
 *
 * A server component: it renders no interactivity, and keeping it off the client
 * bundle matters when a roster puts fifty of them on one screen.
 */

/**
 * Five tints, all built from palette tokens with an opacity modifier, so this
 * honours the no-literal-colours rule and follows the theme into dark mode.
 */
const TINTS = [
  'bg-primary/15 text-foreground',
  'bg-complementary/25 text-foreground',
  'bg-success/15 text-foreground',
  'bg-warning/15 text-foreground',
  'bg-danger/15 text-foreground',
] as const;

const SIZES = {
  sm: 'size-7 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-lg',
} as const;

/**
 * Deterministic, so the same person is the same colour on every screen and after
 * every deploy. A random tint per render would make a roster shimmer on
 * navigation and would stop being a recognition aid, which is the only reason
 * the tint exists.
 */
function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return TINTS[Math.abs(hash) % TINTS.length] as string;
}

function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) return '·';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toLocaleUpperCase('pt-PT');

  // First and last, not first two: "Ana Sofia Conceição" is AC, which is how
  // people abbreviate their own names.
  const first = parts[0] as string;
  const last = parts[parts.length - 1] as string;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toLocaleUpperCase('pt-PT');
}

export function PersonAvatar({
  id,
  name,
  photoUrl = null,
  size = 'md',
  className,
}: {
  /** Anything stable and unique to this person — the tint is derived from it. */
  id: string;
  name: string;
  /**
   * Only ever passed once the caller has established it may be shown. For a
   * student that means a granted, unwithdrawn `photo` consent; for an
   * instructor it is Clerk's cached avatar, which needs no consent record
   * because they are staff who uploaded it themselves.
   */
  photoUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}): React.ReactElement {
  const initials = initialsFor(name);

  return (
    <span
      // Fixed dimensions whether or not there is an image, so a photograph
      // arriving later does not shift the row it sits in.
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium',
        SIZES[size],
        photoUrl === null && tintFor(id),
        className,
      )}
      // The name is already beside every one of these, so the picture itself is
      // decorative and announcing it again would just make a screen reader say
      // each person twice.
      aria-hidden
    >
      {photoUrl === null ? (
        initials
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- avatars come
        // from Clerk and, later, from object storage on a signed URL; neither
        // suits next/image's loader configuration.
        <img src={photoUrl} alt="" className="size-full object-cover" loading="lazy" />
      )}
    </span>
  );
}
