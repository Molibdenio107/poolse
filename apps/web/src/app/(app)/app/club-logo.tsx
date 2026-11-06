'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';

/**
 * The club's logo in the header. A tap shows it large (Rui, 06-11-2026), in the one
 * dialog the app has, so Escape, the backdrop and the close button all work.
 */
export function ClubLogo({ name, fileId }: { name: string; fileId: string }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
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
      <Dialog open={open} onClose={() => setOpen(false)} title={name} closeLabel={t('common.close')}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a served file, not a static asset */}
        <img src={src} alt={name} className="mx-auto max-h-[70dvh] w-full rounded object-contain" />
      </Dialog>
    </>
  );
}
