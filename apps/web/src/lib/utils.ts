import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `twMerge`, told about this project's own size tokens — October 2026.
 *
 * tailwind-merge recognises `text-sm` as a font size, but a custom `text-control`
 * looks to it like a text *colour*, so on any element that also had one —
 * `text-foreground-muted`, `text-primary` — it kept the colour and silently
 * dropped the size. The tab pills and a dozen buttons rendered at 16px with
 * `text-control` written in their source. Naming it here is the fix; a new
 * size token added to `tailwind.config.ts` belongs on this list too.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['control'] }],
    },
  },
});

/**
 * The class-name helper every shadcn component expects to import from here.
 *
 * `clsx` flattens conditionals; `twMerge` resolves Tailwind conflicts so a
 * caller's `px-6` beats a component's default `px-4` instead of both landing in
 * the class list and the last one in the stylesheet winning by accident.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
