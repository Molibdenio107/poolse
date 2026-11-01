import { getTranslations } from 'next-intl/server';
import { PageError } from '@/components/page-shell';
import { storageConfigured } from '@/lib/storage-status';
import { readBoletimTemplate } from './boletim-template.actions';
import { BoletimTemplateEditor } from './boletim-template-editor';

/**
 * The club's own boletim de sócio — POOLSE-142, on *Dados do clube*. The club's
 * and not the site's, which the hint says. Owner and admin, as the tab and the
 * endpoint are; a refusal hides the card, a failure says so in its place.
 */
export async function BoletimTemplatePanel(): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const [loaded, ready] = await Promise.all([readBoletimTemplate(), storageConfigured()]);
  if (loaded.state === 'refused') return null;

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">{t('boletimTemplate.title')}</h2>
        <p className="mt-2 text-sm text-foreground-muted">{t('boletimTemplate.hint')}</p>
      </div>
      {loaded.state === 'failed' ? (
        <PageError message={t(loaded.failure.key)} />
      ) : (
        <BoletimTemplateEditor template={loaded.data.template} storageReady={ready} />
      )}
    </section>
  );
}
