/**
 * The AI failure codes, with no server dependency, so a client screen can tell
 * a model failure from its own notes. What each means: `lib/ai-failure.ts`.
 */
export type AiFailure =
  | 'keyRejected'
  | 'rateLimited'
  | 'unavailable'
  | 'timeout'
  | 'fileRejected'
  | 'readerFault'
  | 'refused'
  | 'tooLong'
  | 'unreadable';

export const AI_FAILURES: readonly AiFailure[] = [
  'keyRejected',
  'rateLimited',
  'unavailable',
  'timeout',
  'fileRejected',
  'readerFault',
  'refused',
  'tooLong',
  'unreadable',
];

export function isAiFailure(value: unknown): value is AiFailure {
  return typeof value === 'string' && (AI_FAILURES as readonly string[]).includes(value);
}

/**
 * The message key for a reader's note: a model failure is said the same way on
 * every screen (`ai.failure.<code>`), anything else keeps the screen's own key.
 * `unreadable` stays the screen's, which already says what to do instead.
 */
export function aiNoteKey(namespace: string, note: string): string {
  return isAiFailure(note) && note !== 'unreadable' ? `ai.failure.${note}` : `${namespace}.${note}`;
}
