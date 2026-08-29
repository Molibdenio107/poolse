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
  variant = 'panel',
  className,
}: {
  /** What the control would do. */
  label: string;
  /** Why it cannot, right now. Always shown — a disabled control with no
   *  explanation reads as a bug. */
  reason: string;
  /**
   * `panel` is the full-width block this started as. `id` is the small square
   * that sits beside a person's name — round 4.
   *
   * The square is the shape of the thing: a student's photograph is an ID
   * photograph, it goes next to the name it identifies, and at that size it is
   * furniture rather than a feature competing with the form. The panel form is
   * still right where a photograph is the subject of its own section, which is
   * what the pool and logo controls are.
   */
  variant?: 'panel' | 'id';
  className?: string;
}): React.ReactElement {
  if (variant === 'id') {
    return (
      <div className={cn('flex w-28 shrink-0 flex-col gap-1.5', className)}>
        {/*
          `aspect-square` and not a fixed height, so the placeholder is the same
          shape as the photograph that will replace it and the row does not jump
          when storage lands.
        */}
        <button
          type="button"
          disabled
          aria-label={label}
          className="flex aspect-square w-full cursor-not-allowed flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-surface-muted text-foreground-muted opacity-60"
        >
          <EntityIcon kind="photo" />
          <span className="px-1 text-center text-[0.65rem] leading-tight">{label}</span>
        </button>
        {/*
          Still visible text, at the smaller size. A disabled control whose reason
          is only in a tooltip is exactly what this repo's tooltip rule forbids.
        */}
        <span className="text-xs leading-tight text-foreground-muted">{reason}</span>
      </div>
    );
  }

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
