import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, type AppPasses } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { describeLoad } from '@/lib/load-failure';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { BuyForm } from './buy-form';

/**
 * *Natação livre* — POOLSE-204, rule 7. Each live pass the reader may use (their
 * own, their children's, a family pack): entries left, valid until, *Pack
 * família*, or *Por pagar*. Then what the club sells on the phone. No list of
 * other people's entries.
 */
export default async function FreeSwim(): Promise<React.ReactElement> {
  const t = await getTranslations();
  let answer: AppPasses;
  try {
    answer = await apiFetch<AppPasses>('/app/passes');
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

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
      <h1 className="text-xl font-semibold tracking-tight">{t('app.passes.title')}</h1>

      {answer.passes.length === 0 ? (
        <p className="text-foreground-muted">{t('app.passes.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded bg-surface px-4 shadow-card">
          {answer.passes.map((pass) => (
            <li key={pass.id} className="flex flex-col gap-0.5 py-3">
              <span className="font-semibold">{pass.productName}</span>
              <span className="text-sm">
                {[
                  pass.entries !== null && pass.entriesLeft !== null
                    ? t('app.passes.left', { left: pass.entriesLeft, total: pass.entries })
                    : null,
                  pass.validUntil !== null ? t('app.passes.until', { date: formatDate(pass.validUntil) }) : null,
                  pass.shared ? t('passes.shareableShort') : null,
                ]
                  .filter((part): part is string => part !== null)
                  .join(' · ')}
              </span>
              {pass.unpaid && <span className="text-sm font-semibold text-danger">{t('app.passes.unpaid')}</span>}
              <span className="text-sm text-foreground-muted">
                {[pass.holderName, pass.facilityName].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {answer.canBuy && answer.forSale.length > 0 && <BuyForm forSale={answer.forSale} people={answer.people} />}
    </>
  );
}
