import { isPoolseSport } from '@poolse/rules';
import type { MessageAudience, MessageSummary } from '@/lib/api';

/**
 * The sentence for whether a message reached anybody — POOLSE-67.
 *
 * Three states, three sentences, the way the water alert and the chase list say
 * theirs: everybody, some, or nobody yet. "Nobody yet" is also what a message
 * reads in its first seconds, while the API is still sending — which is why the
 * sentence says *ainda*, rather than claiming it failed.
 */
export function deliveryKey(
  message: Pick<MessageSummary, 'addressCount' | 'deliveredCount'>,
): { key: string; values: Record<string, number> } {
  if (message.deliveredCount >= message.addressCount && message.addressCount > 0) {
    return { key: 'messages.delivery.all', values: { count: message.addressCount } };
  }
  if (message.deliveredCount === 0) {
    return { key: 'messages.delivery.none', values: { count: message.addressCount } };
  }
  return {
    key: 'messages.delivery.partial',
    values: { delivered: message.deliveredCount, count: message.addressCount },
  };
}

/** "Turma · Cadetes", or "Todo o clube" — the key and the name to fill it with. */
export function audienceKey(audience: MessageAudience): string {
  return `messages.to.${audience}`;
}

/**
 * The name a message's target is shown by. A sport's is the reader's language
 * (POOLSE-146): the API sends the key, and the catalogue names it.
 */
export function targetLabel(
  audience: MessageAudience,
  targetName: string | null,
  t: (key: string) => string,
): string {
  // The catalogue's key, as `sportNameKey` spells it (kept out of a component import for the unit test).
  if (audience === 'sport' && isPoolseSport(targetName)) return t(`sport.name.${targetName}`);
  return targetName ?? '';
}
