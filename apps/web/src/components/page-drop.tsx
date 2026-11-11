'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { DropOverlay, pageDropActive } from '@/components/file-drop';

/**
 * A file dropped anywhere on the page — Rui, 11-11-2026: "the drag and drop
 * should be on the pages, not on the card sections".
 *
 * Mounted once in the app shell. While a file is dragged over a page that has an
 * upload, the page shows the drop overlay. On drop, the file goes to the page's
 * upload that can take it:
 *
 * - **one** (e.g. the logo, or Multimédia's photos): straight there;
 * - **several** (a student's Documentos: photo, ID, boletim, exam): a dialog asks
 *   *Onde guardar este ficheiro?* with each by name, and the file goes to the one chosen;
 * - **none**: the page stays, and a message says the page takes no file. The
 *   browser never opens the file in the tab.
 *
 * "Can take it" is the input's own `accept` (a PDF is not offered to a photo)
 * and not `data-drop-off` (an upload that is unavailable or busy). With a
 * dialog open, only its uploads count. The file is handed to the input as if it
 * had been picked there, so the upload's own rules (type, size, shrinking, the
 * toast) apply unchanged. A page-wide importer (calendar, water, salaries…) and a
 * drop target that took the file itself (a photo dropped on the photo) go first.
 */
export function PageDrop(): React.ReactElement | null {
  const t = useTranslations();
  const toast = useToast();
  const [dragging, setDragging] = useState(false);
  const [choice, setChoice] = useState<{ file: File; options: Candidate[] } | null>(null);
  const live = useRef({ t, toast });
  live.current = { t, toast };

  useEffect(() => {
    let depth = 0;
    const carries = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const mine = (event: DragEvent): boolean => carries(event) && !pageDropActive();

    const onEnter = (event: DragEvent): void => {
      if (!mine(event)) return;
      depth += 1;
      if (candidates(null).length > 0) setDragging(true);
    };
    const onOver = (event: DragEvent): void => {
      // Always prevent: without it the browser opens a stray file in the tab.
      if (mine(event) && !event.defaultPrevented) event.preventDefault();
    };
    const onLeave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent): void => {
      depth = 0;
      setDragging(false);
      if (!mine(event) || event.defaultPrevented) return;
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file === undefined) return;
      const options = candidates(file);
      if (options.length === 0) {
        live.current.toast.show('warning', live.current.t('files.dropNowhere'));
      } else if (options.length === 1) {
        hand(options[0]!.input, file);
      } else {
        setChoice({ file, options });
      }
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

  return (
    <>
      <DropOverlay shown={dragging} label={t('files.dropOnPage')} />
      <Dialog
        open={choice !== null}
        onClose={() => setChoice(null)}
        title={t('files.dropWhereTitle')}
        description={choice?.file.name}
        closeLabel={t('common.close')}
        className="max-w-md"
      >
        <ul className="flex flex-col gap-2">
          {(choice?.options ?? []).map((option, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => {
                  if (choice !== null) hand(option.input, choice.file);
                  setChoice(null);
                }}
                className="flex h-control w-full items-center gap-2 rounded-sm bg-surface px-4 text-left text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Upload aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

interface Candidate {
  input: HTMLInputElement;
  label: string;
}

/** The uploads on the page (or in the open dialog) that would take this file. */
function candidates(file: File | null): Candidate[] {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  const scope: ParentNode = dialogs.length > 0 ? dialogs[dialogs.length - 1]! : document;
  const out: Candidate[] = [];
  for (const input of scope.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    if (input.disabled || input.dataset['dropOff'] === 'true') continue;
    if (file !== null && !accepts(input.accept, file)) continue;
    out.push({ input, label: labelOf(input) });
  }
  return out;
}

/** The input's `accept`, as the browser's picker reads it: MIME types, `type/*` and extensions. */
function accepts(accept: string, file: File): boolean {
  const rules = accept.split(',').map((rule) => rule.trim().toLowerCase()).filter((rule) => rule !== '');
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) =>
    rule.startsWith('.')
      ? name.endsWith(rule)
      : rule.endsWith('/*')
        ? type.startsWith(rule.slice(0, -1))
        : type === rule,
  );
}

/** Its own name, else its aria-label, else the heading of the card it sits in. */
function labelOf(input: HTMLInputElement): string {
  const own = input.dataset['dropLabel'] ?? input.getAttribute('aria-label');
  if (own !== null && own !== undefined && own.trim() !== '') return own.trim();
  const heading = input.closest('section')?.querySelector('h2, h3')?.textContent;
  return heading?.trim() || input.name || '—';
}

/** As if picked there: the upload's own `onChange` runs with its own rules. */
function hand(input: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
