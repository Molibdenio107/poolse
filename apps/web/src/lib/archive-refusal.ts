/**
 * What a refused restore says — POOLSE-78.
 *
 * The API answers a 409 with a code and its figures as fields. This turns that
 * body into a catalogue key and the values the key needs. Kind names and fee
 * kinds are translated here, because a value handed to `t()` must already be
 * words. It is apart from the server action so it can be tested without Next.
 *
 * `null` means the body was not one of ours. The caller then falls back to the
 * generic failure, never to a sentence with holes in it.
 */

export interface ArchiveRefusal {
  errorKey: string;
  values?: Record<string, string | number>;
  /** "Its site is archived too": the entry that would restore the site. */
  parentEntryId?: string;
  parentName?: string;
}

/** `t`, reduced to what this needs, so a test can pass a fake one. */
export type Translate = (key: string) => string;

const CONFLICT_FIELDS = ['name', 'taxNumber', 'socioNumber', 'kind'];

export function archiveRefusal(details: unknown, t: Translate): ArchiveRefusal | null {
  if (typeof details !== 'object' || details === null) return null;
  const body = details as Record<string, unknown>;
  const text = (key: string): string => (typeof body[key] === 'string' ? (body[key] as string) : '');
  const count = (key: string): number => (typeof body[key] === 'number' ? (body[key] as number) : 0);
  const translated = (key: string, fallback: string): string => {
    try {
      return t(key);
    } catch {
      return fallback;
    }
  };
  const kindLabel = (field: string): string =>
    translated(`archive.kind.${text(field)}`, text(field));

  switch (body['code']) {
    case 'already_restored':
      return { errorKey: 'archive.refusal.alreadyRestored' };

    case 'parent_archived': {
      const refusal: ArchiveRefusal = {
        errorKey: 'archive.refusal.parentArchived',
        values: { name: text('parentName'), kind: kindLabel('parentKind') },
        parentName: text('parentName'),
      };
      if (text('parentEntryId') !== '') refusal.parentEntryId = text('parentEntryId');
      return refusal;
    }

    case 'restore_conflict': {
      const field = CONFLICT_FIELDS.includes(text('field')) ? text('field') : 'name';
      // A fee line's clash is on its kind, and the value is the enum.
      const value =
        field === 'kind' ? translated(`fees.kind.${text('value')}`, text('value')) : text('value');
      return {
        errorKey: `archive.refusal.conflict.${field}`,
        values: { value, kind: kindLabel('entityType') },
      };
    }

    case 'licence_exceeded':
      return {
        errorKey: 'archive.refusal.licence',
        values: { current: count('current'), allowed: count('allowed') },
      };

    case 'pool_full':
      return {
        errorKey: 'archive.refusal.poolFull',
        values: { max: count('max'), taken: count('taken') },
      };

    case 'class_full':
      return {
        errorKey: 'archive.refusal.classFull',
        values: { capacity: count('capacity'), taken: count('taken') },
      };

    default:
      return null;
  }
}
