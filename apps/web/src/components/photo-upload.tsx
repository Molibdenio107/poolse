import { EntityIcon } from '@/components/entity-icon';
import { cn } from '@/lib/utils';

/**
 * The place a photograph will go, built now and deliberately switched off.
 *
 * Object storage is decided (Cloudflare R2) but not configured, so this control
 * is **visibly disabled** rather than present-and-broken. That distinction is the
 * whole reason it exists in this state: a button that opens a file picker and
 * then silently discards the file is far worse than one that is plainly off and
 * says why. Nobody loses a photograph to a feature that was never wired.
 *
 * It does not open a picker, accept a drop, or show a progress bar that goes
 * nowhere. `disabled` on a real `<button>` means the browser refuses the click,
 * keyboard activation included — not a CSS class that only looks inert.
 *
 * When storage lands, this becomes a handler and a `disabled={false}`. The
 * surface does not get rebuilt.
 */
export function PhotoUpload({
  label,
  reason,
  className,
}: {
  /** What the control would do. */
  label: string;
  /** Why it cannot, right now. Always shown — a disabled control with no
   *  explanation reads as a bug. */
  reason: string;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded border border-dashed border-border bg-surface-muted p-6 text-center',
        className,
      )}
    >
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-foreground-muted opacity-60"
      >
        <EntityIcon kind="photo" />
        {label}
      </button>
      <span className="text-sm text-foreground-muted">{reason}</span>
    </div>
  );
}
