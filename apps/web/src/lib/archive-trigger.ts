/**
 * What an *Arquivar* control looks like everywhere (Rui, 07-11-2026): quiet, so it
 * is never the thing the eye lands on and never pressed by accident. Muted words,
 * smaller than a button's, a small archive icon, no fill, border or shadow; red
 * only under the pointer or focus. The height stays `h-control`, so a deliberate
 * tap on a phone still lands — it looks small without being hard to hit.
 *
 * Every one of these opens a question before anything is archived
 * (`ConfirmButton` or a `Dialog` with the consequence in words). The button
 * inside that question, which does the archiving, keeps its danger style.
 */
export const ARCHIVE_TRIGGER =
  'inline-flex h-control items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-normal text-foreground-muted hover:bg-danger/5 hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** The icon beside the word, or alone where a table has room for nothing else. */
export const ARCHIVE_ICON = 'size-3.5 shrink-0';
