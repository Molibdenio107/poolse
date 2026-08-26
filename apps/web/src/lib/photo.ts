/**
 * Turns a stored object key into something an <img> can load.
 *
 * Returns null today, because object storage is chosen (Cloudflare R2) but not
 * configured. That is the honest answer rather than a broken URL, and it keeps
 * the shape of the eventual implementation visible: a key becomes a **signed,
 * time-limited** URL, never a public one. These are photographs of children, and
 * a guessable link to another club's pictures is the same class of leak that the
 * row-level security work exists to prevent.
 *
 * The key reaching this function has already passed the consent gate in the SQL
 * that produced it — see PHOTO_CONSENT in the students repository. This function
 * is the second half of the same rule, not a substitute for it.
 */
export function photoUrlFor(storageKey: string | null): string | null {
  if (storageKey === null) return null;

  // TODO(storage): sign the key against the R2 bucket and return a short-lived
  // URL. Until then a stored key resolves to nothing, which is correct: there is
  // nowhere for it to have come from.
  return null;
}
