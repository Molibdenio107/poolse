import { getTranslations } from 'next-intl/server';
import { FileCheck } from 'lucide-react';
import type { FamilyLeave } from '@/lib/api';
import { DocumentLink, FileUpload } from '@/components/file-upload';
import { formatDate } from '@/lib/date-format';

/**
 * The family's atestados — POOLSE-109.
 *
 * Each medical leave the club recorded for one of the reader's children,
 * current or ended in the last 90 days, with the atestado sent for it and a way
 * to send or replace one. The family sees the dates and its own file, never the
 * reason the office typed; the API decides which leaves are theirs.
 */
export async function FamilyCertificates({
  leaves,
  names,
  storageReady,
}: {
  leaves: FamilyLeave[];
  /** Child id → name, shown when the reader has more than one child. */
  names: Map<string, string> | null;
  storageReady: boolean;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  if (leaves.length === 0) return null;

  return (
    <section aria-labelledby="family-certificates" className="flex flex-col gap-2">
      <h2 id="family-certificates" className="text-base font-semibold">
        {t('app.family.certificatesTitle')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('app.family.certificatesHint')}</p>
      <ul className="flex flex-col gap-2">
        {leaves.map((leave) => (
          <li key={leave.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <span className="font-medium">
              {names !== null && names.has(leave.studentId)
                ? `${t('app.family.certificateFor', { name: names.get(leave.studentId)! })} · `
                : ''}
              {leave.endsOn === null
                ? t('sensitive.leaveFrom', { from: formatDate(leave.startsOn) })
                : t('sensitive.leaveRange', { from: formatDate(leave.startsOn), to: formatDate(leave.endsOn) })}
            </span>
            {leave.certificate === null ? (
              <span className="text-sm text-foreground-muted">{t('app.family.certificateMissing')}</span>
            ) : (
              <span className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-1.5 text-foreground-muted">
                  <FileCheck aria-hidden className="size-4" />
                  {t('app.family.certificateSent', { date: formatDate(leave.certificate.attachedAt) })}
                </span>
                <DocumentLink
                  fileId={leave.certificate.fileId}
                  contentType={leave.certificate.contentType}
                  fileName={leave.certificate.originalName}
                  quiet
                />
              </span>
            )}
            <FileUpload
              target={`medical-certificate:${leave.studentId}:${leave.id}`}
              label={leave.certificate === null ? t('app.family.certificateSend') : t('app.family.certificateReplace')}
              hint={t('files.certificateHint')}
              unavailable={storageReady ? null : t('files.notConfigured')}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
