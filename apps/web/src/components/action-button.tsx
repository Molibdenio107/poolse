import Link from 'next/link';
import { EntityIcon, type EntityKind } from '@/components/entity-icon';
import { cn } from '@/lib/utils';

/**
 * A destination that reads as a control — backlog round 3, story 9.
 *
 * The student record used to offer "Progressão" and "Informação médica" as two
 * more text links in a row that also held the back link, which made three things
 * of different weight look identical. These are actions on the record, they
 * belong together, and they are worth finding at a glance on a poolside laptop.
 *
 * Still a `Link` underneath, not a `button`. It navigates, so it must be
 * middle-clickable, open in a new tab, and show its destination in the status
 * bar. A `button` that pushes a route takes all three away and gains nothing.
 *
 * The label always renders. The icon is `aria-hidden` and decorative — CLAUDE.md
 * draws that line and it is the reason removing every icon here would cost
 * polish and no information.
 */
export function ActionButton({
  href,
  icon,
  label,
  tone = 'default',
  className,
}: {
  href: string;
  icon: EntityKind;
  label: string;
  /** `sensitive` marks a destination whose opening is recorded. */
  tone?: 'default' | 'sensitive';
  className?: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 rounded border px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        tone === 'sensitive'
          ? // Warning-toned, not danger-toned. Opening a medical record is a
            // normal part of an instructor's job; it is logged, not forbidden,
            // and a red button would say the wrong thing about a routine act.
            'border-warning/40 bg-warning/10 text-warning hover:border-warning/70'
          : 'border-border bg-surface hover:border-primary/50 hover:text-primary',
        className,
      )}
    >
      <EntityIcon kind={icon} />
      {label}
    </Link>
  );
}
