'use client';

import * as React from 'react';
import { Hint } from '@/components/ui/tooltip';
import { shorten } from '@/lib/shorten';

/**
 * A table cell's text, cut at the end when it is long (Rui, 04-11-2026), with the whole of it in a `Hint` that opens on hover and on
 * keyboard focus. A screen reader is given the full text, never the cut one.
 *
 * The tooltip repeats what the record's own page says in full, so it is never
 * the only place the text appears — the convention in CLAUDE.md holds.
 */
export function ShortText({ text, max }: { text: string; max: number }): React.ReactElement {
  const short = shorten(text, max);
  if (short === text) return <>{text}</>;
  return (
    <Hint text={text}>
      <span
        tabIndex={0}
        className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span aria-hidden>{short}</span>
        <span className="sr-only">{text}</span>
      </span>
    </Hint>
  );
}
