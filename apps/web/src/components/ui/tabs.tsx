'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs — the shadcn/ui shape over Radix, styled with this app's tokens.
 *
 * Radix rather than hand-rolled, unlike `dialog.tsx`: the roving focus, the
 * arrow keys and the `aria-controls` / `aria-labelledby` wiring between a tab
 * and its panel are exactly the fiddly part, and getting one of them wrong is
 * invisible to anybody using a mouse.
 *
 * **A tab looks like every other sub-menu pill** (Rui, 01-11-2026): the
 * handoff's secondary — the card's fill and lift — close together so the row
 * reads as one control, and the current one in the primary fill with the dark
 * ink on it (6.6:1), as the section pills. The weight change and
 * `aria-selected` mean colour is never the only signal, and a waiting-dot on
 * the current tab takes the ink so it stays visible.
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        // Scrolls sideways rather than wrapping: a strip that wraps on a phone
        // changes height between pages, and the sticky header jumps with it.
        // `relative`: a badge's sr-only label is anchored here, not to the page.
        'relative flex items-center gap-1.5 overflow-x-auto whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex h-control shrink-0 items-center gap-1.5 rounded-sm bg-surface px-3.5 text-control text-foreground shadow-card transition-colors',
        'hover:bg-surface-muted',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'data-[state=active]:bg-primary data-[state=active]:font-medium data-[state=active]:text-primary-foreground',
        'data-[state=active]:[&_.attention-dot]:bg-primary-foreground',
        'data-[state=active]:[&_.attention-count]:bg-primary-foreground data-[state=active]:[&_.attention-count]:text-primary',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
      {...props}
    />
  );
});
