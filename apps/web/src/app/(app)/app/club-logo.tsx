'use client';

import { useTranslations } from 'next-intl';
import { PhotoZoom } from '@/components/app/photo-zoom';

/** The club's logo in the header: a tap shows it large (Rui, 06-11-2026). */
export function ClubLogo({ name, fileId }: { name: string; fileId: string }): React.ReactElement {
  const t = useTranslations();
  return (
    <PhotoZoom
      src={`/files/${fileId}`}
      name={name}
      label={t('app.clubLogo', { name })}
      className="size-8 coarse:-m-1.5 coarse:box-content coarse:p-1.5"
    />
  );
}
