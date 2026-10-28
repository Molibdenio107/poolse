"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Matches `details::details-content` in globals.css, so both kinds open alike. */
const DURATION_MS = 220;

/**
 * A section that opens and closes smoothly — Rui, 28-10-2026.
 *
 * A card that appears in one frame shoves everything under it down at once,
 * which reads as the page breaking. This grows from nothing to its own height
 * (the grid-rows 0fr → 1fr technique, which every browser animates) and shrinks
 * back before it unmounts.
 *
 * It replaces `{open && <div>…</div>}`, and keeps that pattern's one property:
 * **closed means unmounted**, so a form inside it starts clean next time and a
 * panel that loads on open still loads on open. It is mounted collapsed, then
 * expanded on the next frame; on close it collapses, then unmounts once the
 * transition has had its time. Reduced motion skips the movement, not the
 * content.
 */
export function Reveal({
  open,
  appear = false,
  id,
  className,
  children,
}: {
  open: boolean;
  /**
   * Grow in even when mounted open — for a section whose parent mounts it, such
   * as an edit row in a table, where the `<tr>` itself cannot animate. Closing
   * such a row stays instant: the parent has already removed it.
   */
  appear?: boolean;
  /** For the trigger's `aria-controls`. */
  id?: string;
  /** On the content box — the padding and border the old `<div>` carried. */
  className?: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open && !appear);
  // Clipping is only for the movement: once open, a menu or a focus ring inside
  // may reach past the edge.
  const [settled, setSettled] = useState(open && !appear);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: the first paints it collapsed, the second lets it grow.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setExpanded(true));
      });
      const timer = window.setTimeout(() => setSettled(true), DURATION_MS + 50);
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
        window.clearTimeout(timer);
      };
    }
    setSettled(false);
    setExpanded(false);
    const timer = window.setTimeout(() => setMounted(false), DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-[220ms] ease-out motion-reduce:transition-none",
        expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      // While it closes it is still in the DOM; nothing in it should take focus.
      inert={!open}
    >
      <div
        className={cn(
          "min-h-0",
          settled ? "overflow-visible" : "overflow-hidden",
        )}
      >
        <div id={id} className={className}>
          {children}
        </div>
      </div>
    </div>
  );
}
