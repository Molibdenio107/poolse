'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';

/**
 * The club's logo in the header. A tap shows it large (Rui, 06-11-2026), in the one
 * dialog the app has, so Escape, the backdrop and the close button all work.
 *
 * It zooms in and out (Rui, 06-11-2026): the dialog stays until `.logo-zoom-out`
 * has played, by a timer rather than `animationend`, because reduced motion plays
 * nothing and an `animationend` that never fires would leave it open.
 */
const ZOOM_OUT_MS = 200;

export function ClubLogo({ name, fileId }: { name: string; fileId: string }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const close = (): void => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, ZOOM_OUT_MS);
  };
  const src = `/files/${fileId}`;
  return (
    <>
      <button
        type="button"
        aria-label={t('app.clubLogo', { name })}
        onClick={() => setOpen(true)}
        className="size-8 shrink-0 overflow-hidden rounded-full coarse:-m-1.5 coarse:box-content coarse:p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a served file, not a static asset */}
        <img src={src} alt="" className="size-8 rounded-full object-cover" />
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={name}
        closeLabel={t('common.close')}
        className={closing ? 'logo-zoom-out' : 'logo-zoom-in'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a served file, not a static asset */}
        <img src={src} alt={name} className="mx-auto max-h-[70dvh] w-full rounded object-contain" />
      </Dialog>
    </>
  );
}
