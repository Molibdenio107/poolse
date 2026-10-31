import 'server-only';
import type { AiReader } from '@poolse/rules';
import { ApiError, apiFetch, apiPost, type Me } from './api';

/**
 * The meter on every model call — POOLSE-137.
 *
 * A reader runs only when its platform switch is on, the club's tick for it is
 * on, and this server has `ANTHROPIC_API_KEY`. The first two are the API's to
 * decide, at the claim, under a lock that also checks the club's monthly cap;
 * the key is this server's own. Every call is claimed before it is made and
 * finished after it, read or not, because the call is what costs.
 *
 * `guardAiCall` (`ai-guard.ts`) still runs first in each action: who in the club
 * may spend, and a per-person brake. This is the club-level door behind it.
 */

/** Why a reader did not run. Each is a sentence where the reader would have acted. */
export type AiGate = 'off' | 'noKey' | 'capReached';

export function anthropicKeyConfigured(): boolean {
  return (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== '';
}

/**
 * Whether a reader would run, asked before anybody uploads, so a screen can
 * say *desligada* up front. The claim is still the decision: this reads `/me`,
 * and a cap reached is only known there.
 */
export function aiReaderGate(reader: AiReader, me: Pick<Me, 'aiReaders'> | null): Exclude<AiGate, 'capReached'> | null {
  if (me === null || !(me.aiReaders ?? []).includes(reader)) return 'off';
  return anthropicKeyConfigured() ? null : 'noKey';
}

/** The same, reading `/me` itself. An unreadable `/me` is off. */
export async function readAiReaderGate(reader: AiReader): Promise<Exclude<AiGate, 'capReached'> | null> {
  const me = await apiFetch<Me>('/me').catch(() => null);
  return aiReaderGate(reader, me);
}

/** What a finished call reports: whether it gave something usable, and what it used. */
export interface MeteredOutcome<T> {
  value: T;
  succeeded: boolean;
  /** The response, for its model and token counts; null when no response came back. */
  response: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } } | null;
}

/**
 * Claim, call, finish. The gate comes back instead of a value when the call
 * was never made. A call that throws is finished as failed and rethrown; a
 * finish that does not land never costs the operator their result.
 */
export async function metered<T>(
  reader: AiReader,
  call: () => Promise<MeteredOutcome<T>>,
): Promise<{ gate: AiGate } | { value: T }> {
  if (!anthropicKeyConfigured()) return { gate: 'noKey' };

  let claim: { id: string };
  try {
    claim = await apiPost<{ id: string }>('/ai-reads/claim', { reader });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'ai_cap_reached') return { gate: 'capReached' };
    // Off, or the meter could not be reached: a call that cannot be counted is
    // not made.
    return { gate: 'off' };
  }

  const finish = (outcome: { succeeded: boolean; response: MeteredOutcome<T>['response'] }) =>
    apiPost(`/ai-reads/${claim.id}/finish`, {
      succeeded: outcome.succeeded,
      model: outcome.response?.model ?? null,
      inputTokens: outcome.response?.usage?.input_tokens ?? null,
      outputTokens: outcome.response?.usage?.output_tokens ?? null,
    }).catch(() => undefined);

  let outcome: MeteredOutcome<T>;
  try {
    outcome = await call();
  } catch (error) {
    await finish({ succeeded: false, response: null });
    throw error;
  }
  await finish(outcome);
  return { value: outcome.value };
}
