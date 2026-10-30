import { getTranslations } from 'next-intl/server';
import { Printer } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import type { StudentDocuments } from '@/lib/fpn-forms';
import { FileUpload } from '@/components/file-upload';
import { PageError } from '@/components/page-shell';

/**
 * *Boletim de sócio* — POOLSE-134 (Rui, 30-10-2026), under Mensalidades beside
 * the sócio it is about. Print it filled from the record, have it signed, file
 * the scan: the panel says whether one is on file, and keeps the older copies.
 * Owner and admin, as the sócio form is.
 */
export async function BoletimPanel({
  studentId,
  storageReady,
}: {
  studentId: string;
  storageReady: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const loaded = await outcome(apiFetch<StudentDocuments>(`/students/${studentId}/documents`));
  if (loaded.state === 'failed') return <PageError message={t(loaded.failure.key)} />;
  if (loaded.state !== 'ok') return <></>;

  const copies = loaded.data.copies.filter((copy) => copy.kind === 'socio_form');
  const current = copies.find((copy) => copy.replacedAt === null);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">{t('boletim.title')}</h2>
      <p className="text-sm">
        {current === undefined
          ? t('boletim.notFiled')
          : t('boletim.filed', { date: formatDate(current.filedAt) })}
      </p>
      {/*
        A plain anchor in a new tab, as the FPN print: a document page, opened
        on the print dialog.
      */}
      <a
        href={`/dashboard/students/${studentId}/boletim?print=1`}
        target="_blank"
        rel="noopener"
        className="inline-flex h-control items-center justify-center gap-2 self-start rounded border border-border px-4 text-control hover:bg-surface-muted"
      >
        <Printer className="size-4" aria-hidden />
        {t('boletim.print')}
      </a>
      <FileUpload
        target={`student-document:${studentId}:socio_form:none`}
        label={t('boletim.upload')}
        hint={t('files.documentHint')}
        unavailable={storageReady ? null : t('files.notConfigured')}
      />
      {copies.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {copies.map((copy) => (
            <li key={copy.id} className="flex flex-wrap gap-x-2">
              <a href={`/files/${copy.fileId}`} className="text-primary underline-offset-2 hover:underline">
                {t('boletim.copy', { date: formatDate(copy.filedAt) })}
              </a>
              {copy.filedByName !== null && <span className="text-foreground-muted">· {copy.filedByName}</span>}
              {copy.replacedAt !== null && (
                <span className="text-foreground-muted">
                  · {t('boletim.replaced', { date: formatDate(copy.replacedAt) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
