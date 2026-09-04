'use client';

import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';

/**
 * Dragging a file anywhere onto the page — the gesture people already try.
 *
 * Lifted out of `students/import-panel.tsx`, which solved it first, because
 * POOLSE-57 needed the same behaviour on the Calendar and a third hand-rolled
 * copy is a third place for the depth counter to be got wrong. The register and
 * the inventory still carry their own; they work, and they can adopt this
 * whenever somebody is in there anyway.
 *
 * **Listeners on the window, not on a bordered rectangle.** The target is "this
 * screen". A drop zone somewhere down the page is a zone people miss, and
 * missing it means the browser navigates away to render the spreadsheet as a
 * download — losing the page they were on.
 *
 * **`dragenter` and `dragover` must both cancel**, or the browser keeps its own
 * default and the drop never reaches this code at all.
 *
 * **The depth is counted, not toggled.** Dragging across a child element fires
 * `dragleave` on the parent, and a naive boolean makes the overlay flicker the
 * whole way across the page.
 */

/** Whether the browser is dragging files rather than selected text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function useFileDrop(onFile: (file: File) => void): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;

    const onEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };

    const onOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
    };

    const onLeave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);

      const file = event.dataTransfer?.files?.[0] ?? null;
      if (file !== null) onFile(file);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFile]);

  return { dragging };
}

/** The full-screen hint, shown only while something is over the page. */
export function DropOverlay({
  shown,
  label,
}: {
  shown: boolean;
  /** Translated by the caller — this component holds no strings. */
  label: string;
}): React.ReactElement | null {
  if (!shown) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10 p-8 backdrop-blur-[1px]"
    >
      <p className="flex items-center gap-3 rounded-lg border-2 border-dashed border-primary bg-surface px-6 py-4 text-lg font-medium shadow-lg">
        <Upload aria-hidden className="size-6" />
        {label}
      </p>
    </div>
  );
}
