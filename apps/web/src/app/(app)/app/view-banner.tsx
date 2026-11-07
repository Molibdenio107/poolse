import { getTranslations } from 'next-intl/server';
import { Eye } from 'lucide-react';
import { formatTime } from '@/lib/date-format';
import { leaveViewAction } from './vista/view.actions';

/**
 * Says whose app this is — POOLSE-188, rule 5. In the sticky header, so it is on
 * every screen and never scrolls away. The words carry it; the colour only adds
 * to them. Drawn by the layout from `/me`, which reads the row, so a view that
 * ended takes its banner with it on the next page.
 */
export async function ViewBanner({
  name,
  hat,
  expiresAt,
}: {
  name: string;
  hat: string;
  expiresAt: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <div className="border-b border-border bg-surface-muted print:hidden">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-2">
        <Eye className="size-5 shrink-0 text-primary" aria-hidden />
        <p className="flex min-w-0 flex-1 flex-col text-sm">
          <strong className="truncate font-semibold">{t('appView.banner', { name })}</strong>
          <span className="text-foreground-muted">
            {t('appView.bannerMeta', { home: t(`appView.${hat}`), time: formatTime(expiresAt) })}
          </span>
        </p>
        <form action={leaveViewAction}>
          <button
            type="submit"
            className="inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control font-medium shadow-card hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('appView.leave')}
          </button>
        </form>
      </div>
    </div>
  );
}
