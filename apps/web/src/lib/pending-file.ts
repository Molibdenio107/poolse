/**
 * A file dropped on one screen and read on another — 29-10-2026.
 *
 * Dropping a laboratory report on any water section jumps to Laboratório (Rui),
 * where the importer lives. A `File` cannot ride a URL, so it waits here in the
 * browser's memory across the client-side navigation, keyed by what it is for,
 * and the importer takes it once on arrival. A full reload loses it, which only
 * means dropping it again.
 */
let pending: { key: string; file: File } | null = null;

export function holdFile(key: string, file: File): void {
  pending = { key, file };
}

/** The file waiting for `key`, once — taking it clears it. */
export function takeFile(key: string): File | null {
  if (pending === null || pending.key !== key) return null;
  const { file } = pending;
  pending = null;
  return file;
}
