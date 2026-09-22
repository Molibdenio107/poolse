import { Logger } from '@nestjs/common';
import {
  BANDS,
  BAND_CAP,
  widgetsFor,
  type Band,
  type ResolverContext,
  type WidgetDefinition,
  type WidgetState,
} from './widget-registry.js';

const logger = new Logger('Dashboard');

/**
 * Composing the page — POOLSE-66, slice 1.
 *
 * Three rules live here and nowhere else, because each of them is a rule about
 * the *page* rather than about any widget:
 *
 *   1. **One widget's failure costs that widget only.** Resolvers run in
 *      parallel under `allSettled` with a per-widget timeout, and a throw or a
 *      timeout becomes `state: 'error'` on that card. The response is still 200:
 *      a dashboard that 500s because one aggregate is slow is a home page that
 *      goes down when any query does.
 *   2. **`empty` is a rendered state.** A resolver answering `null` means "there
 *      is nothing here", which is a sentence a club needs to read — "no tasks
 *      outstanding" — and is not the same as a query that fell over.
 *   3. **A club with no sites sees the checklist and nothing else**, and a club
 *      with sites never sees the checklist. One branch, both directions, so
 *      neither half can drift.
 */

/**
 * How long a widget gets.
 *
 * Two seconds is the ticket's number and it is the right shape of number: long
 * enough that no honest aggregate on a real club reaches it, short enough that a
 * page does not sit blank behind the slowest thing on it.
 *
 * **A timed-out query is not cancelled.** `pg` has no cancellation that is worth
 * the complexity here, so the statement finishes into nothing and returns its
 * connection to the pool as usual. What the timeout protects is the reader, not
 * the database.
 */
export const WIDGET_TIMEOUT_MS = 2000;

/** The one widget that is its own rule — see 3 above. */
export const ONBOARDING_WIDGET_ID = 'setup.checklist';

export interface ComposedWidget {
  id: string;
  size: 1 | 2 | 3;
  priority: number;
  state: WidgetState;
  data: unknown;
}

export interface ComposedBand {
  id: Band;
  order: number;
  widgets: ComposedWidget[];
}

export interface DashboardScope {
  mode: 'all' | 'facility';
  facilityId: string | null;
  facilities: { id: string; name: string }[];
}

export interface Dashboard {
  scope: DashboardScope;
  bands: ComposedBand[];
}

/**
 * Run one resolver, and never let it take the page with it.
 *
 * The rejection path is deliberately quiet on the wire: the card says it could
 * not load and the reason goes to the log. A resolver's error message is written
 * for a developer and can name a column, a constraint or a row — none of which
 * belongs in a browser.
 */
async function resolve(
  widget: WidgetDefinition,
  ctx: ResolverContext,
  timeoutMs: number,
): Promise<{ state: WidgetState; data: unknown }> {
  let timer: NodeJS.Timeout | undefined;

  try {
    const data = await Promise.race([
      widget.resolver(ctx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);

    // `null` is the resolver saying there is nothing to show. Anything else is
    // data, `0` and `false` included — which is why this tests for null rather
    // than for falsiness.
    return data === null || data === undefined
      ? { state: 'empty', data: null }
      : { state: 'ok', data };
  } catch (error) {
    logger.warn(
      `Widget ${widget.id} failed: ` + (error instanceof Error ? error.message : String(error)),
    );
    return { state: 'error', data: null };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The dashboard for one reader.
 *
 * The club's sites are passed in rather than read here: the controller needs
 * them anyway, to validate the selector and to derive a manager's own sites, so
 * they are one query with three uses rather than three queries.
 */
export async function composeDashboard(
  ctx: ResolverContext,
  options: {
    kind: 'business' | 'personal';
    /**
     * The club's sites. **The empty-tenant rule reads this one**, because "has
     * this club got anywhere to teach" is a fact about the club and not about
     * who is asking — an instructor at a club with two pools must not be handed
     * an onboarding checklist because the selector is not theirs.
     */
    sites: DashboardScope['facilities'];
    /** What this reader may choose between; empty for anyone not offered the control. */
    selector: DashboardScope['facilities'];
    /**
     * The registry to compose from, and how long a widget gets. Both default to
     * the product's own — they are parameters so the page's *rules* can be
     * proved against resolvers that throw and hang, in milliseconds and with no
     * database, rather than only against the real catalogue.
     */
    registry?: readonly WidgetDefinition[];
    timeoutMs?: number;
  },
): Promise<Dashboard> {
  const bare = options.sites.length === 0;

  /*
   * Gating first, and it is the whole of the permission story: a widget whose
   * roles the reader does not hold never reaches a resolver, so it cannot appear
   * in the payload even as an error. Hiding a card in a browser is never the
   * control.
   */
  const allowed = widgetsFor(
    { roles: ctx.roles, kind: options.kind },
    options.registry,
  ).filter((widget) =>
    bare ? widget.id === ONBOARDING_WIDGET_ID : widget.id !== ONBOARDING_WIDGET_ID,
  );

  /*
   * Every allowed widget is resolved, not only the four that would survive the
   * cap — because `escalate` reads the resolved data and may change which four
   * those are. The cost is a few aggregates a reader will not see, in parallel,
   * under one 2s ceiling; the alternative is a trial with three days left being
   * cut by a priority that was decided before anybody counted the days.
   */
  const timeoutMs = options.timeoutMs ?? WIDGET_TIMEOUT_MS;
  const settled = await Promise.all(
    allowed.map(async (widget) => ({ widget, ...(await resolve(widget, ctx, timeoutMs)) })),
  );

  const composed = settled.map(({ widget, state, data }) => ({
    widget,
    card: {
      id: widget.id,
      size: widget.size,
      priority:
        state === 'ok' && widget.escalate?.(data) === true
          ? (widget.escalatedPriority ?? widget.priority)
          : widget.priority,
      state,
      data,
    } satisfies ComposedWidget,
  }));

  const bands: ComposedBand[] = [];

  for (const [order, band] of BANDS.entries()) {
    const widgets = composed
      .filter(({ widget }) => widget.band === band)
      // Highest first; ties break on id so the page does not quietly reorder
      // itself between two requests.
      .sort((a, b) => b.card.priority - a.card.priority || a.card.id.localeCompare(b.card.id))
      .slice(0, BAND_CAP)
      .map(({ card }) => card);

    // A band the reader holds no role in is absent, not present and empty: the
    // client should not have to tell "you are not an instructor" from "you have
    // no classes this week".
    if (widgets.length > 0) bands.push({ id: band, order, widgets });
  }

  return {
    scope: {
      mode: ctx.scope.mode,
      facilityId: ctx.scope.facilityId,
      facilities: options.selector,
    },
    bands,
  };
}
