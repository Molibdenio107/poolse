import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Why a model read failed, in words a club can act on — Rui, 11-11-2026.
 *
 * Every AI reader used to turn every failure into "could not read the file",
 * and a rejected API key looked exactly like a broken PDF. Each reader now
 * classifies what went wrong here, once, from the SDK's typed errors (never by
 * matching message text), and every screen shows `ai.failure.<code>`:
 *
 * - `keyRejected`  401 / 403: the server's ANTHROPIC_API_KEY is wrong, revoked or
 *                  without access. Poolse's to fix, not the club's.
 * - `rateLimited`  429: too many reads at once; try again in a minute.
 * - `unavailable`  5xx / 529 overloaded / the network: the service is down for now.
 * - `timeout`      no answer in time: a very long document, or a slow moment.
 * - `fileRejected` 400 / 413: the API refused this file — password-protected,
 *                  too many pages, too big, or not really a PDF/image.
 * - `readerFault`  400 naming our own request (the reply schema): Poolse's bug.
 * - `refused`      the model declined the content.
 * - `tooLong`      the answer outgrew the reply: too many tables at once.
 * - `unreadable`   anything else, including a reply that was not the shape asked for.
 *
 * The cause is also logged on the server (status and the API's own error type and
 * message — never the document), so a failure can be diagnosed from the dev log.
 */
export { AI_FAILURES, isAiFailure, type AiFailure } from './ai-failure-codes';
import type { AiFailure } from './ai-failure-codes';
import { ReplySchemaError } from './ai-schema';

/** What a thrown error from the SDK means for the person who uploaded the file. */
export function classifyAiError(reader: string, error: unknown): AiFailure {
  const code = classify(error);
  const detail =
    error instanceof Anthropic.APIError
      ? `HTTP ${error.status ?? '-'} ${error.message}`
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
  console.warn(`[ai:${reader}] ${code} — ${detail}`);
  return code;
}

function classify(error: unknown): AiFailure {
  // Caught before sending: the reader's own reply format breaks the rules.
  if (error instanceof ReplySchemaError) return 'readerFault';
  // Most specific first: the timeout class extends the connection one.
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'unavailable';
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return 'keyRejected';
  }
  if (error instanceof Anthropic.RateLimitError) return 'rateLimited';
  if (error instanceof Anthropic.BadRequestError) {
    /*
     * A 400 is usually the file, but a key with no workspace answers 400 too
     * ("…not scoped to a workspace…", 11-11-2026), and calling that a refused
     * file sends the club after the wrong thing. The one place a message is
     * read: the API has no separate status or type for it.
     */
    if (/api key|workspace/i.test(error.message)) return 'keyRejected';
    /*
     * A 400 that names our own request — the reply schema ("Schema is too
     * complex", a malformed enum), 12-11-2026 — is Poolse's bug, and blaming the
     * club's file sent Rui looking at a perfectly clean PDF.
     */
    if (/schema|output_config|tools?\./i.test(error.message)) return 'readerFault';
    return 'fileRejected';
  }
  if (error instanceof Anthropic.InternalServerError) return 'unavailable';
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 413) return 'fileRejected';
    if (status === 529 || status >= 500) return 'unavailable';
  }
  return 'unreadable';
}

/** A reply that came back but cannot be used, by its stop reason; null when it can. */
export function stopFailure(stopReason: string | null | undefined): AiFailure | null {
  if (stopReason === 'refusal') return 'refused';
  if (stopReason === 'max_tokens') return 'tooLong';
  return null;
}
