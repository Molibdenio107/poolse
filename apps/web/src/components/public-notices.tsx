import { BookOpen } from 'lucide-react';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';

export interface PublicComplaints {
  regime: 'private' | 'public_service';
  url: string;
}

export interface PublicRegulationView {
  /** Which site it belongs to, where a page shows several. */
  facilityName?: string;
  effectiveFrom: string;
  body: string;
}

/**
 * What every public page carries — POOLSE-73.
 *
 * **The complaints book, "em local visível e de forma destacada"** (DL 156/2005
 * art. 5.º-B n.º 2): a bordered link with its own words, never a line in the
 * footer's small print. Not the DGC icon: its artwork has to come from the
 * official kit, and a redrawn one would be worse than the plain link. A public
 * service's own platform where the club is one (DL 135/99 art. 38.º).
 *
 * **The operating regulation in force** (Portaria 454/2023 art. 46.º — available
 * to users), with the day it took effect, behind a disclosure so a lobby screen
 * is not a wall of rules. The text is the club's, rendered as typed.
 *
 * Labels are passed in: the public pages translate on the server with
 * `createTranslator`, outside any next-intl provider.
 */
export function PublicNotices({
  complaints,
  regulations,
  labels,
  large = false,
}: {
  complaints: PublicComplaints;
  regulations: PublicRegulationView[];
  labels: {
    complaints: string;
    complaintsPublic: string;
    regulation: string;
    effectiveFrom: (date: string) => string;
  };
  large?: boolean;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <a
        href={complaints.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'inline-flex items-center gap-2 self-start rounded border-2 border-foreground px-4 py-2 font-medium',
          'hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          large ? 'text-xl' : 'text-base',
        )}
      >
        <BookOpen aria-hidden className="size-5 shrink-0" />
        {complaints.regime === 'public_service' ? labels.complaintsPublic : labels.complaints}
      </a>

      {regulations.map((regulation) => (
        <details
          key={`${regulation.facilityName ?? ''}${regulation.effectiveFrom}`}
          className="rounded border border-border bg-surface"
        >
          <summary
            className={cn(
              'cursor-pointer list-none p-4 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              large && 'text-xl',
            )}
          >
            {regulation.facilityName === undefined
              ? labels.regulation
              : `${labels.regulation} — ${regulation.facilityName}`}
            <span className="block text-sm font-normal text-foreground-muted">
              {labels.effectiveFrom(formatDate(regulation.effectiveFrom))}
            </span>
          </summary>
          <div className="whitespace-pre-wrap border-t border-border p-4 text-sm leading-relaxed">
            {regulation.body}
          </div>
        </details>
      ))}
    </section>
  );
}
