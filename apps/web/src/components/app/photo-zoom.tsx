'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * A round photo that opens large — the club's logo (Rui, 06-11-2026), and since
 * POOLSE-194 a classmate's or an instructor's. It grows out of its own place and
 * goes back there, a circle alone on the scrim: `.logo-lightbox` takes the dialog's
 * window away, and its title and close button stay for a screen reader. A tap
 * anywhere closes it. The dialog stays until the way back has played, by a timer
 * rather than `animationend`, which reduced motion never fires.
 */
const ZOOM_OUT_MS = 220;
/** The large photo's width as CSS draws it, and the same figure for the sums here. */
const largeSize = (): number => Math.min(window.innerWidth * 0.72, 320);

export function PhotoZoom({
  src,
  name,
  label,
  className,
}: {
  src: string;
  /** Whose photo: the dialog's title and the large image's words. */
  name: string;
  /** What the button says to a screen reader. */
  label: string;
  /** The small photo's size. */
  className?: string;
}): React.ReactElement {
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
  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={show}
        className={cn(
          'shrink-0 overflow-hidden rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          className ?? 'size-8',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a served file, not a static asset */}
        <img ref={small} src={src} alt="" className="size-full rounded-full object-cover" />
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
