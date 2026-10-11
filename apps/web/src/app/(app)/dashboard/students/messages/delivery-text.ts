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
