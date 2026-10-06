/**
 * Which tab a detail page shows — the pure half of `DetailPage`.
 *
 * Kept out of the component so the one rule that decides what somebody sees —
 * "a slug that is missing, unknown or hidden falls back to the first visible
 * tab" — has a test of its own rather than living inside a render.
 */

/**
 * A count ("Piscinas 3") or a dot that says something wants attention.
 *
 * A dot carries its own sentence, read to a screen reader and shown nowhere
 * else, because the tab's content already says it in full: the dot only says
 * "look in here".
 */
export type TabBadge =
  | { kind: 'count'; value: number }
  | { kind: 'dot'; labelKey: string };

export interface TabSpec {
  /** What `?tab=` carries. English, kebab-case, never translated. */
  slug: string;
  labelKey: string;
  /**
   * False hides the tab from the strip *and* from the URL.
   *
   * A boolean rather than a list of roles: every page already has the answer —
   * a `can*` flag from the API, or a list that came back null because the
   * endpoint refused — and a second role list here would be a second rule.
   */
  visible?: boolean | undefined;
  badge?: TabBadge | undefined;
}

/** The visible tabs, in order. */
export function visibleTabs<T extends TabSpec>(tabs: readonly T[]): T[] {
  return tabs.filter((tab) => tab.visible !== false);
}

/**
 * The tab to render for `?tab=<requested>`.
 *
 * Null only when nothing is visible at all, which a caller avoids by making its
 * first tab — General — unconditional.
 */
export function resolveTab<T extends TabSpec>(
  tabs: readonly T[],
  requested: string | string[] | undefined,
): T | null {
  const shown = visibleTabs(tabs);
  const wanted = Array.isArray(requested) ? requested[0] : requested;
  return shown.find((tab) => tab.slug === wanted) ?? shown[0] ?? null;
}

/**
 * The query string for another tab on the same page.
 *
 * Everything already in the URL is kept — `from` is what makes "Voltar" land
 * on the right page — except `page`, which always belongs to the list on the
 * tab being left, and would otherwise open the next tab's list on page 4.
 */
export function tabHref(pathname: string, current: string, slug: string): string {
  const params = new URLSearchParams(current);
  params.delete('page');
  params.set('tab', slug);
  return `${pathname}?${params.toString()}`;
}
