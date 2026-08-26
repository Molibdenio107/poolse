import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
