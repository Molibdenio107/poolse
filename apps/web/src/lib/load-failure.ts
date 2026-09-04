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
    if (error.status === 403) return { key: 'common.notAllowed', detail: '' };
    if (error.status === 404) return { key: 'common.notFound', detail: '' };

    /*
     * The server answered and it went wrong there. The status and message are
     * kept, because this is the one a developer has to diagnose — but they go on
     * their own line rather than running on from the sentence above.
     */
    if (error.status >= 500) {
      return { key: 'common.serverError', detail: `${error.status} ${error.message}`.trim() };
    }

    return { key: 'common.requestRefused', detail: `${error.status} ${error.message}`.trim() };
  }

  // Nothing answered: a dead API, a wrong URL, a network that is down. The only
  // case where "could not reach" is true.
  return { key: 'account.unavailable', detail: String(error) };
}
