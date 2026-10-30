'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Stethoscope } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { DownloadLink } from '@/components/download-link';
import { ExamImportWizard } from './import-wizard';

const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The exames médicos in and out as a spreadsheet — POOLSE-133, on the register
 * beside its own import and export. Owner and admin only; the page shows it to
 * them and the API refuses anybody else. No window-wide drop here: a file
 * dropped on the register is the register's own import.
 */
export function ExamFileActions(): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-foreground-muted">{t('exams.fileActionsLabel')}</span>
        <DownloadLink href="/dashboard/students/exames/export" className={BUTTON_QUIET}>
          <Download aria-hidden className="size-4" />
          {t('exams.export.action')}
        </DownloadLink>
        <button type="button" onClick={() => setOpen(true)} className={BUTTON_QUIET}>
          <Stethoscope aria-hidden className="size-4" />
          {t('exams.import.open')}
        </button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('exams.import.title')}
        closeLabel={t('common.close')}
        className="max-w-4xl"
      >
        {open && <ExamImportWizard onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}
