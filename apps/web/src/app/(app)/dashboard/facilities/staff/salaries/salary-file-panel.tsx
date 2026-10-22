'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Download, Upload } from 'lucide-react';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { Dialog } from '@/components/ui/dialog';
import { SalaryImportWizard } from './import-wizard';

/**
 * Getting the pay list in and out — POOLSE-59, in the page header since
 * POOLSE-97 (Rui, 22-10-2026).
 *
 * **In plain sight, not folded away.** On 12 October 2026 these went into a
 * closed `<details>` after the table, on the reasoning that a club does this
 * about once a year. In testing that read as "import and export are not
 * switched on" — a feature nobody can find is a feature that is off. They are
 * now the header's actions: *Exportar ▾* and *Importar*, one click each.
 *
 * **The drop target is the screen**, not a bordered rectangle somewhere down the
 * page: a zone people miss is a zone the browser wins, and losing that race
 * means navigating away to render the spreadsheet as a download. `useFileDrop`
 * listens on the window and counts depth, which is the part that is easy to get
 * wrong. **A dropped file opens the wizard already read** — asking somebody to
 * choose the file they just dropped would be the screen not believing them.
 *
 * The wizard opens in the shared dialog, over the list it changes, rather than
 * below a table somebody would have to scroll past to find it.
 *
 * The export is plain links: a route handler answers with a file, the browser
 * does what browsers do with an attachment, and it works with no JavaScript at
 * all. Neither link is the permission — the endpoint refuses anybody but an
 * Owner or an Admin, and an Admin's file omits the Owner.
 */

const ACCEPTED = ['.xlsx', '.csv', '.pdf'];

const EXPORT = '/dashboard/facilities/staff/salaries/export';

const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

export function SalaryFileActions({
  canEdit,
  locale,
}: {
  canEdit: boolean;
  locale: string;
}): React.ReactElement {
  const t = useTranslations();

  const [importing, setImporting] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  const [formats, setFormats] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  const onFile = useCallback(
    (file: File) => {
      if (!canEdit || !isAccepted(file)) return;
      setDropped(file);
      setImporting(true);
    },
    [canEdit],
  );

  const { dragging } = useFileDrop(onFile);

  // The format menu closes on Escape and on a click anywhere else, as the
  // register's does: a menu that has to be closed by its own button traps you.
  useEffect(() => {
    if (!formats) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFormats(false);
    };
    const onClick = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) setFormats(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
    };
  }, [formats]);

  const close = (): void => {
    setImporting(false);
    setDropped(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div ref={menu} className="relative">
          <button
            type="button"
            onClick={() => setFormats((open) => !open)}
            aria-expanded={formats}
            aria-haspopup="menu"
            className={BUTTON_QUIET}
          >
            <Download aria-hidden className="size-4" />
            {t('salaries.export.action')}
            <ChevronDown aria-hidden className="size-4" />
          </button>

          {formats && (
            <div
              role="menu"
              aria-label={t('salaries.export.formatLabel')}
              className="absolute right-0 top-full z-20 mt-1 flex min-w-full flex-col rounded border border-border bg-surface py-1 shadow-lg"
            >
              {/*
                Plain anchors, not `Link`: the answer is a file, and `Link`
                would prefetch a spreadsheet. The PDF is a page, so its own tab.
              */}
              {(['xlsx', 'csv', 'pdf'] as const).map((choice) => (
                <a
                  key={choice}
                  role="menuitem"
                  href={choice === 'xlsx' ? EXPORT : `${EXPORT}?format=${choice}`}
                  {...(choice === 'pdf' ? { target: '_blank', rel: 'noopener' } : {})}
                  onClick={() => setFormats(false)}
                  className="whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {t(`salaries.export.${choice}`)}
                </a>
              ))}
            </div>
          )}
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setDropped(null);
              setImporting(true);
            }}
            className={BUTTON_QUIET}
          >
            <Upload aria-hidden className="size-4" />
            {t('salaries.import.open')}
          </button>
        )}
      </div>

      {canEdit && (
        <Dialog
          open={importing}
          onClose={close}
          title={t('salaries.import.title')}
          closeLabel={t('common.close')}
          className="max-w-4xl"
        >
          {importing && (
            <SalaryImportWizard
              /*
                Remounted per opening and per dropped file, so a second import
                never starts on the first one's leftovers — the action states
                React holds outside the wizard included.
              */
              key={dropped?.name ?? 'picker'}
              initialFile={dropped}
              locale={locale}
              onClose={close}
            />
          )}
        </Dialog>
      )}

      <DropOverlay shown={canEdit && dragging} label={t('salaries.import.dropHere')} />
    </>
  );
}
