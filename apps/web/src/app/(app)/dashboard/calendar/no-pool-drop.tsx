'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileSpreadsheet } from 'lucide-react';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { Dialog } from '@/components/ui/dialog';
import { FromLink } from '@/components/from-link';

/**
 * The calendar's drop, while the club has no pool (Rui, 10-11-2026).
 *
 * The timetable import is the page's drop target, and it needs a pool to put
 * the classes in, so with none it is not on the page. A file dropped then did
 * nothing at all, which read as a broken import. This catches the drop and
 * answers it: what is missing, and a link to where it is made. Nothing is read.
 */
export function NoPoolDrop(): React.ReactElement {
  const t = useTranslations();
  const [dropped, setDropped] = useState<string | null>(null);
  const onFile = useCallback((file: File) => setDropped(file.name), []);
  const { dragging } = useFileDrop(onFile);

  return (
    <>
      <DropOverlay shown={dragging} label={t('calendar.nothingYet.dropNoPool')} />
      <Dialog
        open={dropped !== null}
        onClose={() => setDropped(null)}
        title={t('calendar.nothingYet.dropNoPoolTitle')}
        closeLabel={t('common.close')}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4">
          {dropped !== null && (
            <p className="flex items-start gap-2 break-all text-sm text-foreground-muted">
              <FileSpreadsheet aria-hidden className="mt-0.5 size-4 shrink-0" />
              {dropped}
            </p>
          )}
          <p className="text-sm">{t('calendar.nothingYet.dropNoPoolBody')}</p>
          <FromLink
            href="/dashboard/facilities"
            className="inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-5 text-control font-semibold text-primary-foreground"
          >
            {t('calendar.nothingYet.noPoolsLink')}
          </FromLink>
        </div>
      </Dialog>
    </>
  );
}
