'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui Tooltip, on Radix.
 *
 * Radix rather than a hand-rolled hover div for one reason that matters here:
 * `CLAUDE.md` now requires tooltips to open on keyboard focus, not hover alone,
 * and to be announced to screen readers. Radix does both, plus dismissal on
 * Escape and correct placement near a viewport edge — all of which are easy to
 * write badly and tedious to write well.
 *
 * The convention that governs *content* is in CLAUDE.md and is not enforceable
 * in code: a tooltip explains what a control does, and is never the only place a
 * piece of information appears. Anything the operator needs is visible text.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-64 overflow-hidden rounded border border-border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md',
        'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * The whole pattern in one component, because the four-part version is easy to
 * assemble wrongly — a missing Provider silently disables every tooltip beneath
 * it, and nothing errors.
 */
export function Hint({
  children,
  text,
  side = 'top',
}: {
  children: React.ReactNode;
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}): React.ReactElement {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
