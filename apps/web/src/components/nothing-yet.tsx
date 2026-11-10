import { CalendarDays } from 'lucide-react';
import { FromLink } from '@/components/from-link';

/**
 * A page with nothing to show yet, and the next step (Rui, 10-11-2026).
 *
 * In place of a grid or a form that has nothing to work on, which reads as
 * broken: what is missing, why it matters here, and one button to where it is
 * made. The calendar and the make-up lessons use it while a club has no pool
 * or no turma. Strings are translated by the caller. With no `href`, it is one
 * quiet line, for readers who cannot make the missing thing.
 */
export function NothingYet({
  title,
  body,
  href,
  linkLabel,
  children,
}: {
  title?: string;
  body: string;
  href?: string;
  linkLabel?: string;
  /** Extra behaviour that belongs with the card, such as a drop handler. */
  children?: React.ReactNode;
}): React.ReactElement {
  if (href === undefined || linkLabel === undefined || title === undefined) {
    return (
      <section className="rounded bg-surface p-5 shadow-card">
        <p className="text-sm text-foreground-muted">{body}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col items-start gap-3 rounded bg-surface p-5 shadow-card sm:p-8">
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary"
      >
        <CalendarDays className="size-6" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-prose text-sm text-foreground-muted">{body}</p>
      {children}
      <FromLink
        href={href}
        className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-5 text-control font-semibold text-primary-foreground"
      >
        {linkLabel}
      </FromLink>
    </section>
  );
}
