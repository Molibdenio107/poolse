import { getTranslations } from 'next-intl/server';
import { Megaphone } from 'lucide-react';
import { ApiError, apiFetch, type AudienceOptions, type AvisoSummary, type Me } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { formatDate } from '@/lib/date-format';
import { originBack, backProp } from '@/lib/back';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';
import { audienceKey, targetLabel } from '../messages/delivery-text';
import { AvisoComposer, EndAvisoButton } from './aviso-composer';

/**
 * Avisos — POOLSE-166 (Rui, 04-11-2026). What the app shows families and
 * students between two dates: the live ones, the ones scheduled, the ones past,
 * one section at a time, and a folded *Novo aviso* above them. Ended early, an
 * aviso leaves every list and comes back through Arquivados.
 */

const SECTIONS = ['live', 'upcoming', 'past'] as const;

export default async function AvisosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const params = await searchParams;
  const from = typeof params['from'] === 'string' ? params['from'] : undefined;

  let avisos: AvisoSummary[] = [];
  let today = '';
  let options: AudienceOptions | null = null;
  let me: Me | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;
  try {
    const [list, audiences, who] = await Promise.all([
      apiFetch<{ avisos: AvisoSummary[]; today: string }>('/avisos'),
      apiFetch<AudienceOptions>('/messages/audiences'),
      apiFetch<Me>('/me'),
    ]);
    avisos = list.avisos;
    today = list.today;
    options = audiences;
    me = who;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  const canAddressClub = me?.memberships[0]?.roles.some((role) => role === 'owner' || role === 'admin') ?? false;
  const current = pickSection(SECTIONS, params['section'], 'live');
  const shown = avisos.filter((one) => one.state === current);

  return (
    <PageShell title={t('avisos.title')} subtitle={t('avisos.subtitle')} back={backProp(originBack(from), t)}>
      {notPermitted && (
        <section className="flex flex-col gap-1 rounded bg-surface p-5 shadow-card">
          <p className="font-medium">{t('messages.notPermitted')}</p>
          <p className="text-sm text-foreground-muted">{t('messages.notPermittedHint')}</p>
        </section>
      )}
      {failure !== null && (
        <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
      )}

      {options !== null && (
        <details className="rounded bg-surface shadow-card">
          <summary className="cursor-pointer p-5 font-medium">{t('avisos.new')}</summary>
          <div className="border-t border-border p-5">
            <AvisoComposer options={options} canAddressClub={canAddressClub} today={today} />
          </div>
        </details>
      )}

      {!notPermitted && failure === null && (
        <>
          <SectionPills
            label={t('avisos.title')}
            current={current}
            items={SECTIONS.map((key) => ({
              key,
              label: t(`avisos.section.${key}`),
              href: sectionHref('/dashboard/students/avisos', params, key),
              count: avisos.filter((one) => one.state === key).length,
            }))}
          />
          {shown.length === 0 ? (
            <PageEmpty icon={Megaphone} message={t(`avisos.empty.${current}`)} hint={t('avisos.emptyHint')} />
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((aviso) => (
                <li key={aviso.id} className="flex flex-col gap-2 rounded bg-surface p-5 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="font-medium">{aviso.subject}</p>
                      <p className="text-sm text-foreground-muted">
                        {t('avisos.window', { from: formatDate(aviso.shownFrom), until: formatDate(aviso.shownUntil) })}
                      </p>
                    </div>
                    {aviso.canArchive && aviso.state !== 'past' && (
                      <EndAvisoButton avisoId={aviso.id} subject={aviso.subject} />
                    )}
                  </div>
                  {/* Plain text, as typed: a staff member's words, still never HTML. */}
                  <p className="whitespace-pre-wrap text-sm">{aviso.body}</p>
                  <p className="text-xs text-foreground-muted">
                    {t('avisos.meta', {
                      audience: t(audienceKey(aviso.audience) as never, {
                        name: targetLabel(aviso.audience, aviso.targetName, (key) => t(key as never)),
                      } as never),
                      count: aviso.studentCount,
                      author: aviso.sentByName ?? '—',
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageShell>
  );
}
