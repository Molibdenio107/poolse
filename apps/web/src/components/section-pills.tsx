import { AttentionMark } from '@/components/attention-dot';
import { FromLink } from '@/components/from-link';
import { ScrollArrows } from '@/components/scroll-arrows';
import { StickyUnderHeader } from '@/components/sticky-under-header';
import { cn } from '@/lib/utils';

/**
 * One section of a page at a time — the pill row first built for Preços
 * (12 October 2026), and Rui's standing preference since: **the reader scrolls
 * as little as possible**. Where a page or a tab stacks several independent
 * sections, a row of pills names them and only the chosen one is drawn.
 *
 * - **A link per section, `?section=`**, never client state: each section is a
 *   URL that survives a refresh, the back button and a message to a colleague,
 *   and the page renders only what was asked for.
 * - **A section the reader may not see is not offered** — the caller filters
 *   `items` by the same `Outcome` that decides whether the content loads.
 * - **`aria-current`, a fill and the label** say which one is open; colour
 *   never carries it alone.
 *
 * No hooks, so it renders on the server or inside a client component alike.
 * Use `pickSection` to resolve the requested key against what is offered.
 */
export interface SectionPill {
  key: string;
  label: string;
  href: string;
  /**
   * Something in this section needs doing (POOLSE-214): the breathing mark, and
   * these words for a screen reader. Absent is nothing to do. A plain count of
   * what the section holds is never drawn (POOLSE-215): it read as missing work.
   */
  attention?: string | undefined;
  /** How many things to do, when more than one: the mark shows the number (POOLSE-215). */
  attentionCount?: number | undefined;
}

export function SectionPills({
  items,
  current,
  label,
}: {
  items: readonly SectionPill[];
  current: string;
  /** What the row is, for a screen reader: "Secções dos preços". */
  label: string;
}): React.ReactElement | null {
  // One section needs no choosing.
  if (items.length < 2) return null;

  return (
    // A frozen pane under the page's header, so a long section keeps its way to
    // the others in view (POOLSE-92 E). One scrolling line on a phone, so the
    // frozen part of a small screen stays a header and not half the page.
    <StickyUnderHeader>
      {/* `data-scroll-row`: a chip row that scrolls on purpose, like the tab strip. */}
      <ScrollArrows>
        <nav aria-label={label} data-scroll-row className={cn(SUB_MENU_ROW, 'max-md:-m-1 max-md:flex-nowrap max-md:overflow-x-auto max-md:p-1')}>
          {items.map((item) => {
            const on = item.key === current;
            return (
              <FromLink
                key={item.key}
                href={item.href}
                aria-current={on ? 'page' : undefined}
                scroll={false}
                className={subMenuPillClass(on)}
              >
                {item.label}
                {item.attention !== undefined && (
                  <AttentionMark count={item.attentionCount ?? 1} label={item.attention} />
                )}
              </FromLink>
            );
          })}
        </nav>
      </ScrollArrows>
    </StickyUnderHeader>
  );
}

/**
 * **One look for every sub-menu** (Rui, 01-11-2026): section pills, a record's
 * tabs (`ui/tabs.tsx`, the same classes by `data-state`), a view or scope
 * switch, a filter row. The handoff's secondary — the card's fill and lift —
 * and the current one in the primary fill with the dark ink (6.6:1), close
 * together so the row reads as one control. A new row of choices uses these,
 * never its own border-and-tint variant.
 */
export const SUB_MENU_ROW = 'flex flex-wrap gap-1.5';

export function subMenuPillClass(current: boolean): string {
  return cn(
    'inline-flex h-control shrink-0 items-center justify-center gap-2 rounded-sm px-3.5 text-control transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    current
      ? 'bg-primary font-medium text-primary-foreground [&_.attention-dot]:bg-primary-foreground [&_.attention-count]:bg-primary-foreground [&_.attention-count]:text-primary'
      : 'bg-surface text-foreground shadow-card hover:bg-surface-muted',
  );
}

/** The requested section if it is offered, else the first one offered. */
export function pickSection<K extends string>(
  offered: readonly K[],
  requested: string | string[] | undefined,
  fallback: K,
): K {
  const wanted = Array.isArray(requested) ? requested[0] : requested;
  return offered.find((key) => key === wanted) ?? offered[0] ?? fallback;
}

/**
 * A URL for one section, keeping every other query parameter the page carries
 * (`tab`, `from`, a filter) so choosing a section never loses the reader's place.
 * `page` is dropped: it numbers one section's list and means nothing in another.
 */
export function sectionHref(
  path: string,
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === 'section' || name === 'page' || value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) query.append(name, one);
  }
  query.set('section', key);
  return `${path}?${query.toString()}`;
}
