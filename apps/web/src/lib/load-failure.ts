import { ApiError } from './api';

/**
 * Why a page could not load, said accurately — POOLSE-R3-01.
 *
 * Every page caught its load error and printed the same heading: *"Could not
 * reach the API."* It said that for a 500, for a 403, and for a 404 — for every
 * case in which the API had been reached perfectly well and had answered. A
 * malformed id in a URL produced it, and sent whoever saw it to check their
 * network and their dev server, which is the one place the fault was not.
 *
 * "Could not reach" is now reserved for the case where nothing answered.
 */
export interface LoadFailure {
  /** A translation key. The page owns the sentence; this owns which one. */
  key: string;
  /** The server's own words, for the line underneath. Empty when there are none. */
  detail: string;
}

export function describeLoad(error: unknown): LoadFailure {
  if (error instanceof ApiError) {
    // Cases somebody can act on, and which say nothing useful in a status line.
    if (error.status === 401) return { key: 'common.sessionExpired', detail: '' };
    // POOLSE-87: the club has this module switched off — not the reader's role.
    if (error.status === 403 && error.code === 'module_disabled') {
      return { key: 'common.moduleDisabled', detail: '' };
    }
    if (error.status === 403) return { key: 'common.notAllowed', detail: '' };
    if (error.status === 404) return { key: 'common.notFound', detail: '' };

    /*
     * The server answered and it went wrong there — round 5, G2.
     *
     * The status and message used to ride along on their own line. They are the
     * one thing a developer needs and the one thing an operator cannot use:
     * "500 Internal server error" is the string G2 names, and putting it under
     * a page that has already failed reads as the product leaking its plumbing.
     *
     * Logged rather than shown, so nothing is lost for whoever has to diagnose
     * it. A 4xx keeps its detail below, because there the API's own message is
     * specific and true — which field, which rule.
     */
    if (error.status >= 500) {
      // eslint-disable-next-line no-console -- the server log is the point.
      console.error(`[load] HTTP ${error.status}`, error.code, error.message);
      return { key: 'common.serverError', detail: '' };
    }

    return { key: 'common.requestRefused', detail: `${error.status} ${error.message}`.trim() };
  }

  // Nothing answered: a dead API, a wrong URL, a network that is down. The only
  // case where "could not reach" is true.
  return { key: 'account.unavailable', detail: String(error) };
}

/**
 * What a best-effort load came back with — October 2026.
 *
 * Every list on a record page used to be `.catch(() => null)`, and null meant
 * two things at once: "this endpoint refused you" (a 403 — the tab is not this
 * reader's, and hiding it is right) and "it broke" (a 500, a timeout — the tab
 * is theirs and something went wrong). A null drove `visible:`, so on a bad
 * night the Manutenção tab simply vanished from an owner's site, and a link to
 * `?tab=maintenance` fell back to General without a word. A detail page did the
 * same thing with `notFound()`: a timeout read as a deleted record.
 *
 * - `ok`       the data.
 * - `refused`  a 403. The one answer that means "not yours"; callers hide.
 * - `failed`   anything else, with the sentence `describeLoad` chooses and the
 *              status (404 among them) so a detail page can still 404 a 404.
 */
export type Outcome<T> =
  | { state: 'ok'; data: T }
  | { state: 'refused' }
  | { state: 'failed'; failure: LoadFailure; status: number | null };

export async function outcome<T>(request: Promise<T>): Promise<Outcome<T>> {
  try {
    return { state: 'ok', data: await request };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { state: 'refused' };
    return {
      state: 'failed',
      failure: describeLoad(error),
      status: error instanceof ApiError ? error.status : null,
    };
  }
}

/** The data, or null for either kind of absence — for a caller that only reads. */
export function dataOf<T>(loaded: Outcome<T>): T | null {
  return loaded.state === 'ok' ? loaded.data : null;
}

/** Whether a detail page should answer with its 404: refused, or truly missing. */
export function isMissing(loaded: Outcome<unknown>): boolean {
  return loaded.state === 'refused' || (loaded.state === 'failed' && loaded.status === 404);
}
