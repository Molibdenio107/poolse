'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';

/**
 * The club's logo in the header. A tap shows it large (Rui, 06-11-2026), in the one
 * dialog the app has, so Escape, the backdrop and the focus round trip all work.
 *
 * It grows out of its own place in the header and goes back there, as a circle
 * alone on the scrim, with no window around it (Rui, 06-11-2026): `.logo-lightbox`
 * takes the dialog's frame away, and the title and close button stay for a screen
 * reader. A tap anywhere closes it. The dialog stays until the way back has
 * played, by a timer rather than `animationend`, which reduced motion never fires.
 */
const ZOOM_OUT_MS = 220;
/** The large logo's width as CSS draws it, and the same figure for the sums here. */
const largeSize = (): number => Math.min(window.innerWidth * 0.72, 320);

export function ClubLogo({ name, fileId }: { name: string; fileId: string }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [origin, setOrigin] = useState<CSSProperties>({});
  const small = useRef<HTMLImageElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (): void => {
    const box = small.current?.getBoundingClientRect();
    if (box !== undefined) {
      setOrigin({
        '--logo-x': `${box.left + box.width / 2 - window.innerWidth / 2}px`,
        '--logo-y': `${box.top + box.height / 2 - window.innerHeight / 2}px`,
        '--logo-scale': `${box.width / largeSize()}`,
      } as CSSProperties);
    }
    setOpen(true);
  };
  const close = (): void => {
    if (closing) return;
    setClosing(true);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = window.setTimeout(
      () => {
        setOpen(false);
        setClosing(false);
      },
      still ? 0 : ZOOM_OUT_MS,
    );
  };
  const src = `/files/${fileId}`;
  return (
    <>
      <button
        type="button"
        aria-label={t('app.clubLogo', { name })}
        onClick={show}
        className="size-8 shrink-0 overflow-hidden rounded-full coarse:-m-1.5 coarse:box-content coarse:p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a served file, not a static asset */}
        <img ref={small} src={src} alt="" className="size-8 rounded-full object-cover" />
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={name}
        closeLabel={t('common.close')}
        className={closing ? 'logo-lightbox logo-lightbox-closing' : 'logo-lightbox'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a served file, not a static asset */}
        <img
          src={src}
          alt={name}
          style={origin}
          onClick={close}
          className="logo-lightbox-image size-[min(72vw,20rem)] rounded-full bg-surface object-cover"
        />
      </Dialog>
    </>
  );
}
