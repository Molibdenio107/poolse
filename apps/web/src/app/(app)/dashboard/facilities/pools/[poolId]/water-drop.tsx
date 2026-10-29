'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { holdFile } from '@/lib/pending-file';
import { isAcceptedWaterFile, waterFileKey } from './water-import';

/**
 * A report dropped on any water section — Última análise, Tendências, Histórico,
 * Alertas, Registar, Limites (Rui, 29-10-2026). It is held and the page jumps to
 * Laboratório, whose importer reads it on arrival; that section mounts the
 * importer itself and this is not rendered there. Only for who may import.
 */
export function WaterDropCatcher({ poolId, labHref }: { poolId: string; labHref: string }): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { dragging } = useFileDrop((file) => {
    if (!isAcceptedWaterFile(file)) return;
    holdFile(waterFileKey(poolId), file);
    router.push(labHref);
  });
  return <DropOverlay shown={dragging} label={t('facilities.waterImport.drop')} />;
}
