'use client';

import { useTranslations } from 'next-intl';
import { Check, CircleSlash, FileText } from 'lucide-react';
import type { AttendanceStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * How the three attendance states look, defined once — POOLSE-13.
 *
 * The ticket asks for the colours to be tokens reused everywhere rather than
 * re-declared per component, and this is that one place: the register, any
 * summary, and whatever reporting phase 6 builds all read from here.
 *
 * The colours are the palette's own semantic tokens rather than three new ones.
 * "Soft red" and "soft orange" are `danger` and `warning` at low opacity, which
 * is what makes them soft — and it means they move correctly with the theme
 * instead of being two more hex values somebody has to remember to darken.
 *
 * **Colour never carries the meaning alone.** Every state renders its own word
 * and its own glyph, so the register is readable to somebody who cannot tell the
 * red from the amber — and to somebody reading it in bright sun at a poolside,
 * which is the same problem by another route.
 */
export const ATTENDANCE_STATES: readonly AttendanceStatus[] = ['present', 'excused', 'absent'];

const TONE: Record<AttendanceStatus, { chip: string; selected: string; Icon: typeof Check }> = {
  // Unchanged, per the ticket: present keeps the colour it already had.
  present: {
    chip: 'bg-primary/15 text-primary',
    selected: 'border-primary bg-primary/15 font-medium text-primary',
    Icon: Check,
  },
  excused: {
    chip: 'bg-warning/15 text-warning',
    selected: 'border-warning bg-warning/15 font-medium text-warning',
    Icon: FileText,
  },
  absent: {
    chip: 'bg-danger/15 text-danger',
    selected: 'border-danger bg-danger/15 font-medium text-danger',
    Icon: CircleSlash,
  },
};

/** The classes for a chosen radio in the register. */
export function selectedTone(status: AttendanceStatus): string {
  return TONE[status].selected;
}

export function AttendanceIcon({ status }: { status: AttendanceStatus }): React.ReactElement {
  const { Icon } = TONE[status];
  // Decorative: the label is always beside it, and announcing both would make a
  // screen reader say every state twice.
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

/** One state, as a badge. Used wherever a mark is shown rather than chosen. */
export function AttendanceBadge({
  status,
  className,
}: {
  status: AttendanceStatus;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-sm',
        TONE[status].chip,
        className,
      )}
    >
      <AttendanceIcon status={status} />
      {t(`attendance.${status}`)}
    </span>
  );
}

/**
 * The legend the ticket asks for wherever several states appear together.
 *
 * It repeats what each badge already says, which is the point: somebody scanning
 * a marked register sees three colours before they read a single word, and the
 * legend is what tells them which is which without having to find an example of
 * each.
 */
export function AttendanceLegend({ className }: { className?: string }): React.ReactElement {
  return (
    <ul className={cn('flex flex-wrap items-center gap-2', className)}>
      {ATTENDANCE_STATES.map((status) => (
        <li key={status}>
          <AttendanceBadge status={status} />
        </li>
      ))}
    </ul>
  );
}
