import { ApiError } from './api';
import type { FormState } from '@/app/(app)/dashboard/actions';

/**
 * Why a save failed, said in a way somebody can act on — POOLSE-QA-06.
 *
 * The reported bug: *"Não foi possível guardar a turma."* was the entire error.
 * It did not say which field, which rule, or whether trying again could help —
 * and it was returned identically for a lapsed session, a role that may not do
 * this, a value the API refused and a server that never answered. Four different
 * situations, three of which the operator can fix themselves, all wearing the
 * same sentence.
 *
 * The old shape is what made that inevitable: any status under 500 collapsed to
 * the caller's fallback key with no detail attached, so the *only* failure that
 * said anything was the one nobody can do anything about.
 *
 * Two audiences, and they need different things:
 *
 * - **The operator** gets a translated sentence naming the situation, and
 *   field-level keys where the API named fields.
 * - **Whoever is looking at the log** gets the status, the code and the message,
 *   because a failure that reaches a user un-diagnosable is a bug report that
 *   costs a session to reproduce. This one did.
 */
export function describeFailure(error: unknown, fallbackKey: string): FormState {
  if (error instanceof ApiError) {
    log(`${fallbackKey}: HTTP ${error.status}`, error.code, error.message);

    // A lapsed session, or a token the client never got. Retrying the form is
    // futile and looks like the button is broken; signing in again is the fix.
    if (error.status === 401) return { ok: false, errorKey: 'common.sessionExpired' };

    if (error.status === 403) {
      return {
        ok: false,
        errorKey:
          error.code === 'no_organization' ? 'common.noOrganization' : 'common.notAllowed',
      };
    }

    // Two people wanting the same name, or the same slot. The caller owns this
    // sentence because only it knows what "already exists" means here.
    if (error.status === 409) return { ok: false, errorKey: `${fallbackKey}Conflict` };

    if (error.status === 404) return { ok: false, errorKey: 'common.notFound' };

    /*
     * A refused value. `fields` is the good case — it lands beside the box that
     * caused it. Without it, the API's own message is still better than silence,
     * so it rides along as detail: untranslated, but true and specific.
     */
    if (error.status < 500) {
      const fields = Object.keys(error.fields).length > 0 ? error.fields : undefined;
      return {
        ok: false,
        errorKey: fallbackKey,
        ...(fields ? { fields } : { detail: error.message }),
      };
    }

    return { ok: false, errorKey: fallbackKey, detail: `${error.status} ${error.message}`.trim() };
  }

  /*
   * Never reached the API at all — the usual cause is the API not running, and
   * on this project that has happened twice from two dev servers fighting over
   * the port. "Could not reach the server" sends somebody to look at the right
   * thing; "could not save" sends them to re-read a form that was fine.
   */
  log(`${fallbackKey}: no response`, null, String(error));
  return { ok: false, errorKey: 'common.apiUnreachable', detail: String(error) };
}

function log(where: string, code: string | null, message: string): void {
  // eslint-disable-next-line no-console -- the server log is the point.
  console.error(`[form] ${where}${code === null ? '' : ` (${code})`} — ${message}`);
}
