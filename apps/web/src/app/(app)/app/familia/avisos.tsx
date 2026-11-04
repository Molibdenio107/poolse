'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Megaphone } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { formatDate } from '@/lib/date-format';
import type { AppAviso } from '@/lib/api';

/**
 * The club's live avisos — POOLSE-166 rule 3 (Rui, 04-11-2026). A sheet on
 * opening the app, which *Fechar* hides for this session only, and a card on
 * Início that stays for as long as the aviso's window runs. Nobody but the
 * office ends one: closing the sheet is "I have seen it", not "never again".
 *
 * The session is `sessionStorage`, read in a try/catch: a browser that refuses
 * storage shows the sheet every time rather than breaking the page.
 */
const KEY = 'poolse.avisos.closed';

function closedIds(): Set<string> {
  try {
    return new Set((window.sessionStorage.getItem(KEY) ?? '').split(',').filter((id) => id !== ''));
  } catch {
    return new Set();
  }
}

export function FamilyAvisos({ avisos }: { avisos: AppAviso[] }): React.ReactElement | null {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  // After mount: the server cannot know what this session has closed.
  useEffect(() => {
    const closed = closedIds();
    setOpen(avisos.some((aviso) => !closed.has(aviso.id)));
  }, [avisos]);

  if (avisos.length === 0) return null;

  const close = (): void => {
    try {
      const closed = closedIds();
      for (const aviso of avisos) closed.add(aviso.id);
      window.sessionStorage.setItem(KEY, [...closed].join(','));
    } catch {
      // Storage refused: the sheet simply comes back next time.
    }
    setOpen(false);
  };

  const list = (
    <ul className="flex flex-col gap-3">
      {avisos.map((aviso) => (
        <li key={aviso.id} className="flex flex-col gap-1">
          <p className="font-bold">{aviso.subject}</p>
          {/* Plain text, as the club typed it — never HTML. */}
          <p className="whitespace-pre-wrap text-sm">{aviso.body}</p>
          <p className="app-secondary text-xs text-foreground-muted">
            {t('avisos.app.until', { date: formatDate(aviso.shownUntil) })}
            {aviso.studentNames.length > 0 && ` · ${t('avisos.app.about', { names: aviso.studentNames.join(', ') })}`}
          </p>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <section
        aria-label={t('avisos.app.title', { count: avisos.length })}
        className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card"
      >
        <h2 className="flex items-center gap-2 font-bold">
          <Megaphone aria-hidden className="size-4 text-primary" />
          {t('avisos.app.title', { count: avisos.length })}
        </h2>
        {list}
      </section>

      <Dialog
        open={open}
        onClose={close}
        title={t('avisos.app.title', { count: avisos.length })}
        closeLabel={t('avisos.app.close')}
        placement="sheet"
      >
        <div className="flex flex-col gap-4">
          {list}
          <button
            type="button"
            onClick={close}
            className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground"
          >
            {t('avisos.app.close')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
