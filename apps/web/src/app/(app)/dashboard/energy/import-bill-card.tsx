'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import {
  InvoiceForm,
  type FacilityOption,
  type MeterOption,
} from '../facilities/energy/[meterId]/invoices/invoice-form';

/**
 * *Importar fatura* — POOLSE-106. The Energia page's first job, folded.
 *
 * The 12-10-2026 salaries disclosure, kept in the page's header area because a
 * bill is what this page is mostly opened for: a `<details>`, so the browser's
 * own disclosure is keyboard-operable and announced as one. **Closed by
 * default, and remembered per browser** — an operator who keeps it open finds
 * it open, one who only reads the dashboard is not made to scroll past a form.
 * Storage is a convenience: any failure to read or write it leaves the card
 * closed and the page working.
 *
 * **It opens on its own** for a file dropped anywhere on the page (the form
 * reads it, or says why it cannot), and for a missing bill's link, which
 * names the meter so the form opens on it.
 */

const STORAGE_KEY = 'poolse.energy.importOpen';

export function ImportBillCard({
  meters,
  facilities,
  importAvailable,
  meterId,
}: {
  meters: MeterOption[];
  facilities: FacilityOption[];
  importAvailable: boolean;
  /** Set by a missing bill's link (`?import=<meter>`): open, on that meter. */
  meterId?: string | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  // The remembered state, once in the browser; a link that asked for the card wins.
  useEffect(() => {
    if (meterId !== undefined) {
      setOpen(true);
      return;
    }
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) === 'open');
    } catch {
      // Private window or blocked storage: closed, as by default.
    }
  }, [meterId]);

  const remember = (next: boolean): void => {
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed');
    } catch {
      // Not remembered this time; the card still works.
    }
  };

  return (
    <details
      id="importar"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) remember(next);
      }}
      className="group scroll-mt-24 rounded border border-border bg-surface"
    >
      <summary className="flex min-h-control cursor-pointer list-none items-center gap-2 rounded p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        <span className="font-medium">{t('energy.importCard.summary')}</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-4">
        <p className="text-sm text-foreground-muted">{t('energy.invoice.importPageSubtitle')}</p>
        <InvoiceForm
          // A different meter from a link is a fresh form on that meter.
          key={meterId ?? 'any'}
          meters={meters}
          facilities={facilities}
          importAvailable={importAvailable}
          collapsed
          dropAnywhere
          initialMeterId={meterId}
          onDropped={() => setOpen(true)}
        />
      </div>
    </details>
  );
}
