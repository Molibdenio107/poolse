'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Makes a whole area take a dropped file for the upload inside it — Rui,
 * 30-10-2026: a photo is dropped onto the photo, not aimed at its button.
 *
 * It hands the file to the first `<input type="file">` within, as if it had
 * been picked there, so the upload's own rules (type, size, shrinking, the
 * toast) apply unchanged and nothing is uploaded twice. An area with no file
 * input inside takes nothing.
 */
export function DropTarget({
  children,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}): React.ReactElement {
  const area = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const carriesFiles = (event: React.DragEvent): boolean => Array.from(event.dataTransfer.types).includes('Files');

  return (
    <div
      ref={area}
      onDragOver={(event) => {
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!area.current?.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const input = area.current?.querySelector<HTMLInputElement>('input[type="file"]');
        const file = event.dataTransfer.files[0];
        if (input === null || input === undefined || file === undefined || input.disabled) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }}
      className={cn('rounded', over && 'outline outline-2 outline-offset-4 outline-dashed outline-primary', className)}
    >
      {children}
    </div>
  );
}
