/** The reception screen's shared classes — one size for every control, as everywhere. */

export const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const PANEL = 'flex flex-col gap-4 rounded border border-border bg-surface p-5';
export const PANEL_TITLE =
  'text-sm font-medium uppercase tracking-wider text-foreground-muted';
