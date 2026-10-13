import { getTranslations } from 'next-intl/server';
import { DetachFileButton, FileUpload } from '@/components/file-upload';
import { apiFetch } from '@/lib/api';
import { fileUrl } from '@/lib/files';
import { storageConfigured } from '@/lib/storage-status';

/**
 * The club's logo — 12 October 2026.
 *
 * Beside the NIPC on the site's *Dados do clube* tab (moved from Faturação on
 * 13 October 2026) because both are how the club appears as itself: on its own
 * documents, and in the corner of every screen (the app bar's brand slot,
 * which belongs to the customer rather than to Poolse). Owner and admin, as the
 * rest of this tab.
 */
export async function LogoPanel(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const [{ fileId }, ready] = await Promise.all([
    apiFetch<{ fileId: string | null }>('/settings/logo'),
    storageConfigured(),
  ]);
  const url = fileUrl(fileId);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-medium">{t('files.logoTitle')}</h2>
        <p className="text-sm text-foreground-muted">{t('files.logoHint')}</p>
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
