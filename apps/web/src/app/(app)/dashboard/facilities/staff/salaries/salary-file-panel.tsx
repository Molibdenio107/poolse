'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Download, Upload } from 'lucide-react';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { SalaryImportWizard } from './import-wizard';

/**
 * Getting the pay list in and out — POOLSE-59.
 *
 * **The drop target is the screen**, not a bordered rectangle somewhere down the
 * page: a zone people miss is a zone the browser wins, and losing that race
 * means navigating away to render the spreadsheet as a download. `useFileDrop`
 * listens on the window and counts depth, which is the part that is easy to get
 * wrong.
 *
 * **A dropped file opens the wizard already read.** The upload step is skipped
 * for it — they have chosen the file, and asking them to choose it again would
 * be the screen not believing what they just did.
 *
 * The export is two ordinary links: a route handler answers with a file, the
 * browser does what browsers do with an attachment, and it works with no
 * JavaScript at all. Neither link is the permission — the endpoint refuses
 * anybody but an Owner or an Admin, and an Admin's file omits the Owner.
 *
 * **Folded away by default** (12 October 2026): a club does this about once a
 * year, so it is a `<details>` after the table with a summary line that says
 * what is inside, rather than three buttons everybody scrolls past every week.
 * A file dropped anywhere on the screen unfolds it — the wizard it opens must
 * not be hidden inside a closed box.
 */

const ACCEPTED = ['.xlsx', '.csv'];

const BUTTON_QUIET =
   'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

export function SalaryFilePanel({
  canEdit,
  locale,
}: {
  canEdit: boolean;
  locale: string;
}): React.ReactElement {
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  const [unfolded, setUnfolded] = useState(false);

  const onFile = useCallback(
    (file: File) => {
      if (!canEdit || !isAccepted(file)) return;
      setDropped(file);
      setOpen(true);
      setUnfolded(true);
    },
    [canEdit],
  );

  const { dragging } = useFileDrop(onFile);

  return (
    <>
    <details
      open={unfolded}
      onToggle={(event) => setUnfolded(event.currentTarget.open)}
      className="group rounded border border-border bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
        />
        <span className="flex flex-col">
          <span className="font-medium">{t('salaries.file.summary')}</span>
          <span className="text-sm text-foreground-muted">{t('salaries.file.summaryHint')}</span>
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href="/dashboard/facilities/staff/salaries/export" className={BUTTON_QUIET}>
          <Download aria-hidden className="size-4" />
          {t('salaries.exportXlsx')}
        </a>
        <a href="/dashboard/facilities/staff/salaries/export?format=csv" className={BUTTON_QUIET}>
          <Download aria-hidden className="size-4" />
          {t('salaries.exportCsv')}
        </a>

        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setDropped(null);
              setOpen((was) => !was);
            }}
            aria-expanded={open}
            className={BUTTON_QUIET}
          >
            <Upload aria-hidden className="size-4" />
            {t('salaries.import.open')}
          </button>
        )}
      </div>

      {open && canEdit && (
        <div className="rounded border border-border bg-surface-muted p-4">
          <SalaryImportWizard
            /*
              Remounted per opening and per dropped file, so a second import
              never starts on the first one's leftovers. `restart()` inside the
              wizard clears its own state; the key clears everything, including
              the action states React holds outside it.
            */
            key={dropped?.name ?? 'picker'}
            initialFile={dropped}
            locale={locale}
            onClose={() => {
              setOpen(false);
              setDropped(null);
            }}
          />
        </div>
      )}
      </div>
    </details>

    {/* Outside the box: a closed <details> draws nothing but its summary. */}
    <DropOverlay shown={canEdit && dragging} label={t('salaries.import.dropHere')} />
    </>
  );
}
