import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarPlus, ChevronRight, Waves } from 'lucide-react';
import { apiFetch, type AppPasses } from '@/lib/api';
import { withFrom } from '@/lib/back';
import { outcome } from '@/lib/load-failure';
import { LinkBusy } from '@/components/link-busy';

const HERE = '/app/perfil/mais-natacao';

/**
 * *+ Natação* (Rui, 09-11-2026): more swimming than the lessons a family already
 * has, in one place on *Perfil*. *Natação livre* (POOLSE-204) where there is a
 * pass to see or a pack to buy, and *Pedir inscrição numa turma* (POOLSE-121),
 * always. Each opens its own page, which comes back here.
 */
export default async function MoreSwimming(): Promise<React.ReactElement> {
  const t = await getTranslations();
  // Best effort: the free-swim row is only offered when there is something in it.
  const passes = await outcome(apiFetch<AppPasses>('/app/passes'));
  const swims = passes.state === 'ok' && (passes.data.passes.length > 0 || passes.data.forSale.length > 0);
  const row =
    'flex min-h-[52px] items-center justify-between gap-3 rounded bg-surface px-4 py-2 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

  return (
    <>
      <Link
        href="/app/perfil?home=family"
        aria-label={t('app.profile.backTo')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.moreSwimming.title')}</h1>

      {swims && (
        <Link href={withFrom('/app/perfil/natacao-livre', HERE)} className={row}>
          <span className="flex items-center gap-3">
            <Waves className="size-5 text-primary" aria-hidden />
            {t('app.passes.title')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      <Link href={withFrom('/app/familia/inscrever', HERE)} className={row}>
        <span className="flex items-center gap-3">
          <CalendarPlus className="size-5 text-primary" aria-hidden />
          {t('app.join.open')}
        </span>
        <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
        <LinkBusy />
      </Link>
    </>
  );
}
