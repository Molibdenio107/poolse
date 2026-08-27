'use client';

import { useTranslations } from 'next-intl';
import { bySeniority, type MemberRole } from '@/lib/roles';
import { cn } from '@/lib/utils';

/**
 * A role, coloured — POOLSE-18.
 *
 * **The colour is on the chip and nowhere else.** Not the row, not the avatar,
 * not the name. A list where whole rows carry a hue stops being scannable at
 * about six people, because the eye has nothing quiet to rest on; the chips are
 * small enough to compare and small enough to ignore.
 *
 * **The word is always there.** Every badge renders its translated role name, so
 * the colour is a way of finding something you already know how to read rather
 * than the only way of knowing it. That is the rule from CLAUDE.md — colour never
 * carries meaning alone — and it is why these still work in a screenshot printed
 * in grey.
 *
 * **Clear of the attendance palette** (POOLSE-13), deliberately: soft red is
 * "faltou" and soft orange is "falta justificada", and a role chip in either
 * hue sitting near a register would read as a state. None of the six is red or
 * amber.
 *
 * Colours are tokens in `globals.css`, so a role looks the same here, in a
 * filter chip and in the invite dialog without any of them knowing about each
 * other.
 */

/**
 * Full class names, not interpolated.
 *
 * `bg-role-${role}/15` would be built at runtime and Tailwind, which scans the
 * source as text, would never emit those classes — the badges would come out
 * unstyled with nothing in the console to say why. Written out, they are found.
 */
const TONE: Record<MemberRole, string> = {
  owner: 'bg-role-owner/15 text-role-owner',
  admin: 'bg-role-admin/15 text-role-admin',
  instructor: 'bg-role-instructor/15 text-role-instructor',
  maintenance: 'bg-role-maintenance/15 text-role-maintenance',
  guardian: 'bg-role-guardian/15 text-role-guardian',
  student: 'bg-role-student/15 text-role-student',
};

/** An unknown role still renders — greyed, with its name — rather than unstyled. */
const FALLBACK = 'bg-surface-muted text-foreground-muted';

export function RoleBadge({
  role,
  className,
}: {
  role: string;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-sm',
        TONE[role as MemberRole] ?? FALLBACK,
        className,
      )}
    >
      {t(`roles.${role}`)}
    </span>
  );
}

/**
 * Every role a person holds, in seniority order.
 *
 * One human, one row, several badges — the People list's half of POOLSE-17. The
 * component exists so no screen has to remember the ordering rule.
 */
export function RoleBadges({
  roles,
  className,
}: {
  roles: readonly string[];
  className?: string;
}): React.ReactElement {
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {bySeniority(roles).map((role) => (
        <RoleBadge key={role} role={role} />
      ))}
    </span>
  );
}
