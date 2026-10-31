/** The reception screen's shared classes — one size for every control, as everywhere. */

export const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded px-4 text-control hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card';

export const PANEL = 'flex flex-col gap-4 rounded bg-surface p-5 shadow-card';
export const PANEL_TITLE =
  'text-sm font-medium uppercase tracking-wider text-foreground-muted';
