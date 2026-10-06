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
 * **The active pill is a tint with a ring, not a solid fill.** White on the
 * brand primary is 2.72:1 and sits on `contrast:check`'s known-failures list;
 * a label on a 15% wash of the primary is ordinary foreground text, and the
 * ring and the weight change mean the colour is never the only signal.
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
        'flex items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]',
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
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-foreground-muted transition-colors',
        'hover:bg-surface-muted hover:text-foreground',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'data-[state=active]:bg-primary/15 data-[state=active]:font-medium data-[state=active]:text-foreground',
        'data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-primary',
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
