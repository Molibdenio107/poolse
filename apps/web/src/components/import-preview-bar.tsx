'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarClock } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useBusyWhile } from '@/lib/busy';
import { previewCounts, setImportPreview, useImportPreview } from '@/lib/import-preview';
import { runTimetableImportAction } from '@/app/(app)/dashboard/calendar/import/import.actions';

/**
 * An import waiting for *Confirmar* — POOLSE-224, rules 1 to 3 and 9.
 *
 * In the shell, so it stays across the calendar and Turmas. It says what is
 * waiting in words, writes nothing until *Confirmar* (which sends the same rows
 * to the same endpoint, re-checked there), and stands guard while it waits:
 * a link out of the calendar and Turmas asks first, and closing or reloading
 * the tab gets the browser's own warning. A reload leaves nothing behind,
 * because the preview only ever lived in this tab's memory.
 */

/** Where a waiting import may be looked at from. */
const KEEPS = ['/dashboard/calendar', '/dashboard/classes'];

function keeps(path: string): boolean {
  return KEEPS.some((root) => path === root || path.startsWith(`${root}/`));
}

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function ImportPreviewBar(): React.ReactElement | null {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const preview = useImportPreview();
  const waiting = preview !== null && preview.done === undefined && preview.reopen === undefined;

  const [confirming, setConfirming] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useBusyWhile(confirming, 'save');

  // The tab: the browser's own "leave page?" while an import waits.
  useEffect(() => {
    if (!waiting) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [waiting]);

  /*
   * In-app links: there is no route-change event in the App Router, so a link
   * is caught on its way down, before Next's own handler sees it. Every in-app
   * link is an anchor (`FromLink`, `Link`), so one capture listener covers them.
   */
  useEffect(() => {
    if (!waiting) return;
    const guard = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || keeps(url.pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [waiting]);

  // A finished import's line goes once the person moves on.
  useEffect(() => {
    if (preview?.done !== undefined && !keeps(pathname)) setImportPreview(null);
  }, [pathname, preview?.done]);

  if (preview === null || preview.reopen !== undefined) return null;

  if (preview.done !== undefined) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2 text-sm print:hidden">
        <CalendarClock aria-hidden className="size-4 text-success" />
        <span className="font-medium">{t('importPreview.done', { classes: preview.done.created, turmas: preview.done.turmas })}</span>
        <button type="button" className={QUIET} onClick={() => setImportPreview(null)}>
          {t('common.close')}
        </button>
      </div>
    );
  }

  const counts = previewCounts(preview);

  const confirm = async (): Promise<void> => {
    setConfirming(true);
    const data = new FormData();
    data.set('facilityId', preview.facilityId);
    data.set('poolId', preview.poolId);
    data.set('rows', preview.rowsJson);
    data.set('settings', JSON.stringify({ commit: true, drop: preview.drop, replace: preview.replace, fileName: preview.fileName }));
    const answer = await runTimetableImportAction({ ok: false, attempt: 0 }, data);
    setConfirming(false);

    if (!answer.ok || answer.result === undefined) {
      toast.show('danger', t(answer.errorKey ?? 'timetableImport.failed'));
      return;
    }
    if (answer.result.committable && (answer.result.created ?? 0) > 0) {
      setImportPreview({ ...preview, done: { created: answer.result.created ?? 0, turmas: answer.result.turmasCreated ?? 0 } });
      router.refresh();
      return;
    }
    // Something changed since the preview (rule 2): back to the conflict step, nothing written.
    toast.show('warning', t('importPreview.changed'));
    setImportPreview({ ...preview, reopen: answer.result });
    if (!pathname.startsWith('/dashboard/calendar')) router.push('/dashboard/calendar');
  };

  return (
    <>
      <div
        role="region"
        aria-label={t('importPreview.region')}
        className="flex flex-wrap items-center gap-3 border-b border-primary bg-primary/10 px-4 py-2 text-sm print:hidden"
      >
        <CalendarClock aria-hidden className="size-4 text-primary" />
        <span className="font-medium">
          {t('importPreview.waiting', { classes: counts.classes, turmas: counts.newTurmas })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} disabled={confirming} aria-busy={confirming} onClick={() => void confirm()}>
            {t('importPreview.confirm')}
          </button>
          <button type="button" className={QUIET} disabled={confirming} onClick={() => setAskDiscard(true)}>
            {t('importPreview.discard')}
          </button>
        </div>
      </div>

      <Dialog
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title={t('importPreview.discardAsk')}
        description={t('importPreview.discardBody')}
        closeLabel={t('common.close')}
        className="max-w-md"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              setAskDiscard(false);
              setImportPreview(null);
            }}
          >
            {t('importPreview.discard')}
          </button>
          <button type="button" className={QUIET} onClick={() => setAskDiscard(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={leaveTo !== null}
        onClose={() => setLeaveTo(null)}
        title={t('importPreview.leaveAsk')}
        description={t('importPreview.leaveBody')}
        closeLabel={t('common.close')}
        className="max-w-md"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              const to = leaveTo;
              setLeaveTo(null);
              setImportPreview(null);
              if (to !== null) router.push(to);
            }}
          >
            {t('importPreview.leaveYes')}
          </button>
          <button type="button" className={QUIET} onClick={() => setLeaveTo(null)}>
            {t('importPreview.stay')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
