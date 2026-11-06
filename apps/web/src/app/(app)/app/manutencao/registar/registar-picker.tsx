'use client';

import { useState } from 'react';
import { ChevronRight, SprayCan, Wrench } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { OneTap } from '../one-tap';

/**
 * One *Registar* row and the sheet it opens — POOLSE-181. The sheet lists what
 * is open; each item is `OneTap`, so completing one shows the same toast as on
 * *Hoje* and the item leaves on the refresh that follows (never revalidated in
 * the action — see maintenance.actions.ts). Strings arrive translated: the page
 * is a server component and this holds none of its own.
 */
export function RegistarPicker({
  kind,
  label,
  hint,
  empty,
  closeLabel,
  items,
}: {
  kind: 'complete' | 'clean';
  label: string;
  hint: string;
  empty: string;
  closeLabel: string;
  items: { id: string; name: string; detail: string; actionLabel: string }[];
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const Icon = kind === 'complete' ? Wrench : SprayCan;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-control w-full items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3 text-left shadow-card hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            <Icon className="size-4" aria-hidden />
            {label}
          </span>
          <span className="text-sm text-foreground-muted">{hint}</span>
        </span>
        <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label} closeLabel={closeLabel} placement="sheet">
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">{empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{item.name}</span>
                  {item.detail !== '' && <span className="text-sm text-foreground-muted">{item.detail}</span>}
                </span>
                <OneTap kind={kind} id={item.id} label={item.actionLabel} />
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
