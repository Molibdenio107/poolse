'use client';

import { useEffect, useRef } from 'react';
import { Plus, Upload, type LucideIcon } from 'lucide-react';
import { Button, type ButtonVariant } from './button';

/**
 * A page-header button that asks a panel further down to open — POOLSE-232
 * (Rui, 19-11-2026: Inventário's and Energia's add and import "in the page
 * header, clearly visible").
 *
 * The form stays where it was, owned by its panel; the header only says "open
 * it". One window event per action (`poolse:<page>-<action>`), so no state is
 * lifted into a server page and no form exists twice. The panel listens with
 * `usePageAction` and opens and scrolls to itself.
 *
 * The icon is named, not passed: a server page cannot hand a component (a
 * function) to this client one — it renders, then fails at the boundary.
 */
const ICONS: Record<'add' | 'import', LucideIcon> = { add: Plus, import: Upload };

export function PageAction({
  event,
  variant = 'primary',
  icon,
  children,
}: {
  event: string;
  variant?: ButtonVariant;
  icon?: keyof typeof ICONS;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Button
      variant={variant}
      {...(icon === undefined ? {} : { icon: ICONS[icon] })}
      onClick={() => window.dispatchEvent(new CustomEvent(event))}
    >
      {children}
    </Button>
  );
}

/** The panel's side: run `open` when the header's button is pressed. */
export function usePageAction(event: string, open: () => void): void {
  const handler = useRef(open);
  handler.current = open;
  useEffect(() => {
    const listener = (): void => handler.current();
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }, [event]);
}

/** Scrolls an element into view once it has been drawn (after a `Reveal` mounts it). */
export function scrollToId(id: string): void {
  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 60);
}
