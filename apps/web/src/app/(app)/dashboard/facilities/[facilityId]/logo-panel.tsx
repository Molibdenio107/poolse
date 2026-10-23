import { getTranslations } from 'next-intl/server';
import { DetachFileButton, FileUpload } from '@/components/file-upload';
import { apiFetch } from '@/lib/api';
import { fileUrl } from '@/lib/files';
import { storageConfigured } from '@/lib/storage-status';

/**
 * The club's logo — 12 October 2026.
 *
 * At the top of the site's *Fotografias* tab, above the site's photographs
 * (POOLSE-104 C; before that beside the NIPC on *Dados do clube*): both are how
 * the club looks — in the corner of every screen (the app bar's brand slot,
 * which belongs to the customer rather than to Poolse) and on a printed
 * document. It is the club's, not the site's, and the hint says so. Owner and
 * admin, as the rest of the page.
 */
export async function LogoPanel(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const [{ fileId }, ready] = await Promise.all([
    apiFetch<{ fileId: string | null }>('/settings/logo'),
    storageConfigured(),
  ]);
  const url = fileUrl(fileId);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('files.logoTitle')}
        </h2>
        <p className="mt-2 text-sm text-foreground-muted">{t('files.logoHint')}</p>
      </div>
      {url !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- streamed through /files/:id
        <img src={url} alt={t('files.logoAlt')} className="h-16 w-auto self-start rounded border border-border bg-surface p-1" />
      )}
      <div className="flex flex-wrap items-start gap-2">
        <FileUpload
          target="logo"
          label={url === null ? t('files.logoUpload') : t('files.logoReplace')}
          hint={t('files.photoHint')}
          unavailable={ready ? null : t('files.notConfigured')}
        />
        {url !== null && <DetachFileButton target="logo" label={t('files.logoRemove')} />}
      </div>
    </section>
  );
}
