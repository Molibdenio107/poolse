'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import type { StudentLevel } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ImportWizard } from './import/import-wizard';

/**
 * The import, on the register itself.
 *
 * It used to be its own page, which was one click and one navigation away from
 * the list somebody was looking at when they decided to import. Opening it in
 * place keeps the register on screen — the thing the file is about — and makes
 * the result visible the moment it lands, because the server component behind
 * this panel is revalidated by the commit.
 *
 * It is also the drop target for the whole screen. Dragging the club's
 * spreadsheet onto the register is the gesture people already try, and the
 * honest answer to trying it is to do the thing rather than to bounce the file
 * back at the browser, which opens it as a download in a new tab.
 *
 * **A drop asks before it does anything.** Files are dragged by accident — over
 * a window on the way to somewhere else, or the wrong one out of a folder of
 * twenty — and a screen that begins reading a file nobody meant to give it is a
 * screen people stop dragging onto. The dialog costs one keystroke and buys the
 * gesture its confidence back.
 */

const ACCEPTED = ['.xlsx', '.csv'];

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Whether the browser is dragging files rather than selected text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

export function StudentActions({
  levels,
  exportHref,
  filtering,
}: {
  levels: StudentLevel[];
  /** The export link, already carrying the register's current filters. */
  exportHref: string;
  filtering: boolean;
}): React.ReactElement {
  const t = useTranslations();

  /*
   * The three actions live in here with the panel rather than beside it.
   *
   * Opening the importer is client state — a drop opens it too, and a drop
   * cannot change the URL — so the button that opens it has to be in the same
   * component that holds the flag. Adding and exporting are plain links that
   * came along for the ride; they cost nothing to render here and keep the row
   * one row.
   */
  const [open, setOpen] = useState(false);
  const [formats, setFormats] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** The dropped file waiting for a yes or a no. */
  const [pending, setPending] = useState<File | null>(null);
  /** The file the wizard is working on. Set only once the operator has agreed. */
  const [accepted, setAccepted] = useState<File | null>(null);

  const panel = useRef<HTMLDivElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const exportMenu = useRef<HTMLDivElement | null>(null);

  /*
   * Listeners on the window, not on a bordered rectangle.
   *
   * The target is "the students screen", so the whole screen has to accept the
   * drop. A drop zone somewhere down the page is a zone people miss, and missing
   * it means the browser navigates away from the register to render the
   * spreadsheet as a download — losing the page they were on.
   *
   * `dragenter`/`dragover` must both cancel, or the browser keeps its own
   * default and the drop never reaches this code at all.
   */
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

    // Counted rather than toggled: dragging across a child element fires leave
    // on the parent, and a naive toggle makes the overlay flicker the whole way
    // across the page.
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
      if (file !== null) setPending(file);
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
  }, []);

  /*
   * The format menu closes on Escape and on a click anywhere else — the two
   * things everybody tries. Without them it is a menu that traps you, which is
   * the reason open menus are worse than no menu at all.
   */
  useEffect(() => {
    if (!formats) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFormats(false);
    };
    const onClick = (event: MouseEvent): void => {
      if (!exportMenu.current?.contains(event.target as Node)) setFormats(false);
    };

    window.addEventListener('keydown', onKey);
    // Capture, so a click on a control that stops propagation still closes this.
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
    };
  }, [formats]);

  const dismiss = useCallback(() => setPending(null), []);

  // Escape closes the question, which is what every other dialog on the web
  // does and what somebody who dropped the wrong file reaches for first.
  useEffect(() => {
    if (pending === null) return;

    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, dismiss]);

  const reveal = (): void => {
    // A long register scrolls; the panel opens at the top of it, so say where
    // it went rather than leaving somebody looking at row forty wondering
    // whether the button did anything.
    requestAnimationFrame(() =>
      panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const accept = (): void => {
    if (pending === null || !isAccepted(pending)) return;
    setAccepted(pending);
    setPending(null);
    setOpen(true);
    reveal();
  };

  const close = (): void => {
    setAccepted(null);
    setOpen(false);
  };

  const usable = pending !== null && isAccepted(pending);

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/students/new" className={BUTTON}>
          {t('students.add')}
        </Link>

        <button
          type="button"
          onClick={() => {
            // Already open and showing a dropped file: clicking again should
            // give a clean sheet rather than leave the old one on screen.
            setAccepted(null);
            setOpen(true);
            reveal();
          }}
          aria-expanded={open}
          className={BUTTON_QUIET}
        >
          {t('students.import.action')}
        </button>

        {/*
          The format is asked for only once exporting has been asked for.

          A permanently visible picker made somebody answer a question they had
          not asked yet — most exports are the workbook, and the choice is only
          interesting to the person who wants the other one. So the button is the
          action, and the two shapes it can take appear underneath it.

          Plain anchors, not `Link`: the answer is a file, so there is no client
          navigation to make and `Link` would prefetch a spreadsheet.
        */}
        <div ref={exportMenu} className="relative">
          <button
            type="button"
            onClick={() => setFormats((open) => !open)}
            aria-expanded={formats}
            aria-haspopup="menu"
            className={BUTTON_QUIET}
          >
            {filtering ? t('students.export.actionFiltered') : t('students.export.action')}
          </button>

          {formats && (
            <div
              role="menu"
              aria-label={t('students.export.formatLabel')}
              className="absolute left-0 top-full z-20 mt-1 flex min-w-full flex-col rounded border border-border bg-surface py-1 shadow-lg"
            >
              {(['xlsx', 'csv'] as const).map((choice) => (
                <a
                  key={choice}
                  role="menuitem"
                  href={`${exportHref}${exportHref.includes('?') ? '&' : '?'}format=${choice}`}
                  onClick={() => setFormats(false)}
                  className="whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {choice === 'xlsx'
                    ? t('students.export.formatXlsx')
                    : t('students.export.formatCsv')}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-6"
        >
          <div className="flex flex-col items-center gap-3 rounded border-2 border-dashed border-primary bg-surface px-10 py-8 text-center">
            <FileSpreadsheet className="size-8 text-primary" />
            <p className="text-lg font-medium">{t('students.import.dropTitle')}</p>
            <p className="text-sm text-foreground-muted">{t('students.import.dropHint')}</p>
          </div>
        </div>
      )}

      {pending !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-drop-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4"
        >
          <div className="flex w-full max-w-md flex-col gap-4 rounded border border-border bg-surface p-5 shadow-lg">
            <h2 id="import-drop-title" className="text-base font-medium">
              {usable ? t('students.import.confirmTitle') : t('students.import.confirmRefused')}
            </h2>

            <p className="flex items-start gap-2 text-sm">
              <FileSpreadsheet aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
              <span className="break-all font-medium">{pending.name}</span>
            </p>

            <p className="text-sm text-foreground-muted">
              {usable ? t('students.import.confirmHint') : t('students.import.errorFileType')}
            </p>

            <div className="flex flex-wrap justify-end gap-3">
              {usable && (
                <button ref={confirmButton} type="button" onClick={accept} className={BUTTON}>
                  <span className="flex items-center gap-2">
                    <Upload aria-hidden className="size-4" />
                    {t('students.import.confirmAccept')}
                  </span>
                </button>
              )}
              <button
                ref={usable ? null : confirmButton}
                type="button"
                onClick={dismiss}
                className={BUTTON_QUIET}
              >
                {usable ? t('students.import.confirmCancel') : t('students.import.confirmClose')}
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <section
          ref={panel}
          className={cn('flex flex-col gap-4 rounded border border-border bg-surface p-5')}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('students.import.title')}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{t('students.import.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('students.import.close')}
              className="rounded border border-border p-1.5 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          {/*
            Keyed on the file so a second drop starts a clean wizard rather than
            trying to reconcile a new spreadsheet with the previous one's mapping,
            which would point column indexes at a grid that no longer has them.
          */}
          <ImportWizard
            key={accepted === null ? 'chosen' : `${accepted.name}:${accepted.lastModified}`}
            levels={levels}
            initialFile={accepted}
            onClose={close}
          />
        </section>
      )}
    </>
  );
}
