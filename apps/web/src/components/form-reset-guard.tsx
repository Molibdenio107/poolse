'use client';

import { useEffect } from 'react';

/**
 * Keeps a form's choices on screen through React 19's reset — 19 October 2026.
 *
 * React resets a `<form action={fn}>` when the action returns, refusals included.
 * Every field here is controlled (`pnpm forms:check`), and a text input survives
 * the reset because React keeps its default in step with its value. A checkbox, a
 * radio and a `<select>` do not: the reset puts them back to their value at mount,
 * and React does not redraw them because their state did not change. Measured:
 * after a refused save a ticked box read unticked and a select read its first
 * option while state held the other — and a named select then *submitted* that
 * first option, the wrong value, on the next press.
 *
 * The reset event fires before the browser resets, so this copies each such
 * control's current value into its default first, and the reset puts back exactly
 * what is on screen. Mounted once per root layout; nothing in Poolse relies on a
 * form reset clearing those controls (a create form clears by `useSuccessKey`).
 * File inputs are left alone, so they still clear after an upload.
 */
export function FormResetGuard(): null {
  useEffect(() => {
    function keep(event: Event): void {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      for (const element of Array.from(form.elements)) {
        if (
          element instanceof HTMLInputElement &&
          (element.type === 'checkbox' || element.type === 'radio')
        ) {
          element.defaultChecked = element.checked;
        } else if (element instanceof HTMLSelectElement) {
          for (const option of Array.from(element.options)) {
            option.defaultSelected = option.selected;
          }
        }
      }
    }
    // Capture, so it runs before anything that might act on the reset.
    document.addEventListener('reset', keep, true);
    return () => document.removeEventListener('reset', keep, true);
  }, []);

  return null;
}
