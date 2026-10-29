'use client';

import { useEffect } from 'react';
import { REVEAL_EASING, REVEAL_MS } from './ui/reveal';

/**
 * Every native `<details>` opens and closes smoothly — Rui, 29-10-2026.
 *
 * The CSS route (`::details-content` with `interpolate-size`) animated only in
 * Chromium, and there at 220 ms linear-out; Safari and Firefox snapped open, so
 * on an iPhone every folded card in the app was abrupt. This does it the way that
 * works everywhere: one delegated click listener takes the summary's click,
 * animates the element's height from where it is to where it will be (the Web
 * Animations API), fades the content in, and only then lets the element close.
 * A click mid-animation turns it round from where it stands.
 *
 * Mounted once per root layout, like `FormResetGuard`, so a `<details>` written
 * anywhere needs nothing. `data-instant` on one opts it out. Reduced motion, or a
 * click on a control inside the summary, is left to the browser. Opening still
 * goes through `details.open`, so `toggle` fires and `onToggle` handlers run.
 */
export function DetailsAnimator(): null {
  useEffect(() => {
    const running = new WeakMap<HTMLDetailsElement, { animation: Animation; opening: boolean }>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    function closedHeight(details: HTMLDetailsElement, summary: HTMLElement): number {
      const style = window.getComputedStyle(details);
      const edges = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'] as const;
      return (
        summary.getBoundingClientRect().height +
        edges.reduce((sum, edge) => sum + (Number.parseFloat(style[edge]) || 0), 0)
      );
    }

    function onClick(event: MouseEvent): void {
      if (event.defaultPrevented || reduced.matches) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const summary = target.closest('summary');
      if (summary === null) return;
      const details = summary.parentElement;
      if (!(details instanceof HTMLDetailsElement) || details.firstElementChild !== summary) return;
      if (details.hasAttribute('data-instant')) return;
      // A button or a link inside the summary does its own thing.
      const control = target.closest('a, button, input, select, textarea');
      if (control !== null && summary.contains(control)) return;

      event.preventDefault();

      const current = running.get(details);
      const opening = current ? !current.opening : !details.open;
      const start = details.getBoundingClientRect().height;
      current?.animation.cancel();

      details.style.overflow = 'hidden';
      let end: number;
      if (opening) {
        details.style.height = '';
        details.open = true;
        end = details.getBoundingClientRect().height;
        for (const child of Array.from(details.children)) {
          if (child !== summary) {
            child.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: REVEAL_MS,
              easing: REVEAL_EASING,
            });
          }
        }
      } else {
        end = closedHeight(details, summary);
      }

      // `fill: forwards` holds the last frame until the element has closed:
      // without it the height springs back to full for one frame first.
      const animation = details.animate([{ height: `${start}px` }, { height: `${end}px` }], {
        duration: REVEAL_MS,
        easing: REVEAL_EASING,
        fill: 'forwards',
      });
      running.set(details, { animation, opening });
      animation.onfinish = () => {
        running.delete(details);
        if (!opening) details.open = false;
        animation.cancel();
        details.style.overflow = '';
      };
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}
