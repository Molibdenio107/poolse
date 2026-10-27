'use client';

import { useEffect } from 'react';

/**
 * Opens the print dialog once the document has painted.
 *
 * The water report's `PrintButton` deliberately waits to be asked. This page is
 * different: it is reached only by the document's "PDF" link, which *is* the
 * asking — the same as every list's `format=pdf` page, which prints on load. A
 * frame's delay so the dialog shows the document rather than a blank sheet.
 */
export function AutoPrint(): null {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.print());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return null;
}
