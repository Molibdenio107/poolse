'use client';

import { useEffect } from 'react';

/**
 * Opens the print dialog once the document has painted.
 *
 * The water report's `PrintButton` deliberately waits to be asked. This page is
 * different: it is reached only by the document's "PDF" link, which *is* the
 * asking — the same as every list's `format=pdf` page, which prints on load. A
 * frame's delay so the dialog shows the document rather than a blank sheet —
 * and, since a club's own boletim is an image (POOLSE-142), not before the
 * page's images have arrived, or the form prints blank around its words.
 */
export function AutoPrint(): null {
  useEffect(() => {
    let frame = 0;
    let gone = false;
    const pending = Array.from(document.images)
      .filter((image) => !image.complete)
      .map((image) => new Promise<void>((done) => {
        image.addEventListener('load', () => done(), { once: true });
        image.addEventListener('error', () => done(), { once: true });
      }));
    void Promise.all(pending).then(() => {
      if (!gone) frame = window.requestAnimationFrame(() => window.print());
    });
    return () => {
      gone = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
