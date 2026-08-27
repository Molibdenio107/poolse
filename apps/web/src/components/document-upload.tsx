import { FileText, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The identification document slot — POOLSE-11.
 *
 * Inert, exactly as the pool and student photo controls are and for the same
 * reason: file storage is still an open decision, and one decision unblocks all
 * three. Present, styled and visibly disabled beats absent — an operator who
 * cannot see where a document *will* go assumes the product cannot hold one.
 *
 * **Its own slot, never an avatar.** The ticket is explicit and it matters: a
 * Cartão de Cidadão rendered as somebody's profile picture would put a
 * government identity document on every list that shows a face.
 *
 * **The purpose and the retention are stated here, at the point of upload**,
 * rather than in a ticket of their own. A Cartão de Cidadão is special-category
 * identity data under the GDPR: whoever is about to hand one over is entitled to
 * know why it is wanted and how long it is kept, and the moment they are asked
 * is the only moment that notice is worth anything. The words are in the message
 * catalogue so a club can have them reviewed and changed without a deploy.
 *
 * Every view and download of a stored document will be audited, the way medical
 * notes already are. That code arrives with storage; this comment is the note
 * that it must.
 */
export function DocumentUpload({
  label,
  reason,
  purpose,
  className,
}: {
  /** What the control would do. */
  label: string;
  /** Why it cannot, right now. A disabled control with no explanation reads as a bug. */
  reason: string;
  /** Why the document is being asked for, and how long it is kept. */
  purpose: string;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded border border-dashed border-border bg-surface-muted p-6 text-center',
        className,
      )}
    >
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-foreground-muted opacity-60"
      >
        <FileText className="size-4" aria-hidden />
        {label}
      </button>

      <span className="text-sm text-foreground-muted">{reason}</span>

      {/*
        Not a tooltip. CLAUDE.md draws the line and this is exactly the case it
        draws it for: anything the person needs is visible text, and a retention
        notice reachable only by hovering is a notice that was never given.
      */}
      <p className="flex items-start gap-2 text-left text-sm text-foreground-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        {purpose}
      </p>
    </div>
  );
}
