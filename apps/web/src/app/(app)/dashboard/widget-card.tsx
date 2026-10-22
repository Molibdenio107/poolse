import { FromLink } from '@/components/from-link';
import { getTranslations } from 'next-intl/server';
import type { DashboardWidget, WidgetState } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * One card, and the three things a card can be — POOLSE-66, slice 2a.
 *
 * **`empty` and `error` are drawn differently, and that is the point.** A club
 * with no tasks outstanding and a query that fell over must not look the same:
 * the first is good news, the second is something to tell somebody about. The
 * server decides which — a resolver answering `null` is `empty`, one that throws
 * is `error` — and nothing here infers a state from absent data.
 *
 * **An `error` card says nothing about why.** The resolver's own words name
 * columns, constraints and rows; they go to the server log, and the reader gets
 * a sentence written for a person. That is `compose.ts`'s rule and this is the
 * other end of it.
 *
 * **Every card links to its real page**, in all three states. A card that has
 * failed is still the way to the thing it failed to summarise, and a card with
 * nothing to show is often exactly where somebody wants to go and add the first
 * one. The link is a `FromLink`, so the back link on the far side comes home.
 */

const LINK =
  'text-sm text-primary hover:underline coarse:py-3 coarse:pr-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Column span inside a band's grid — the registry's `size`, as a class. */
const SPAN: Record<1 | 2 | 3, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};

export async function WidgetCard({
  widget,
  title,
  href,
  linkLabel,
  links,
  emptyMessage,
  compact = false,
  children,
}: {
  widget: DashboardWidget;
  title: string;
  /** Where this card's subject actually lives. Always offered. */
  href: string;
  linkLabel: string;
  /**
   * Several destinations in place of the one — a card whose subject lives on
   * each site's own page offers each site rather than the list of them
   * (POOLSE-92). When given, `href` and `linkLabel` are not drawn.
   */
  links?: readonly { href: string; label: string }[] | undefined;
  /**
   * What "there is nothing here" means for *this* widget, in its own voice.
   *
   * Passed per card rather than shared: "no bills yet" and "nothing
   * outstanding" are different facts, and one generic sentence for both would
   * make the good news unreadable.
   */
  emptyMessage: string;
  /**
   * One line rather than a card — title, body and link side by side, wrapping
   * on a phone. For a registry `trailing` widget (POOLSE-103 C), which is
   * something to find on the page rather than something the page is about.
   */
  compact?: boolean;
  children?: React.ReactNode;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  if (compact) {
    return (
      <section
        className={cn(
          'flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-border bg-surface px-5 py-3',
          SPAN[widget.size],
        )}
      >
        <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {title}
        </h3>
        <div className="min-w-0 flex-1">
          <Body state={widget.state} emptyMessage={emptyMessage} errorMessage={t('dashboard.widgetFailed')}>
            {children}
          </Body>
        </div>
        <FromLink href={href} className={cn('coarse:-my-3', LINK)}>
          {linkLabel}
        </FromLink>
      </section>
    );
  }

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded border border-border bg-surface p-5',
        SPAN[widget.size],
      )}
    >
      <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {title}
      </h3>

      <Body state={widget.state} emptyMessage={emptyMessage} errorMessage={t('dashboard.widgetFailed')}>
        {children}
      </Body>

      {links !== undefined && links.length > 1 ? (
        <ul className="mt-auto flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.href}>
              <FromLink href={link.href} className={cn('coarse:-my-3', LINK)}>
                {link.label}
              </FromLink>
            </li>
          ))}
        </ul>
      ) : (
        <FromLink href={links?.[0]?.href ?? href} className={cn('mt-auto self-start coarse:-mb-3', LINK)}>
          {links?.[0]?.label ?? linkLabel}
        </FromLink>
      )}
    </section>
  );
}

function Body({
  state,
  emptyMessage,
  errorMessage,
  children,
}: {
  state: WidgetState;
  emptyMessage: string;
  errorMessage: string;
  children?: React.ReactNode;
}): React.ReactElement {
  if (state === 'error') {
    /*
     * Muted rather than red. A card that could not load is not a refusal and not
     * a fault the reader caused; the danger tone belongs to things that went
     * wrong *because of* something somebody did, and spending it here would
     * make it mean less where it matters. `role="status"` so a screen reader is
     * told, since the card otherwise looks like any other.
     */
    return (
      <p role="status" className="text-sm text-foreground-muted">
        {errorMessage}
      </p>
    );
  }

  if (state === 'empty') return <p className="text-sm text-foreground-muted">{emptyMessage}</p>;

  return <>{children}</>;
}
