import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { ApiError, apiFetch, type AppChildDocuments, type AppDocumentRow } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { describeLoad } from '@/lib/load-failure';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { ChildFilter } from '../child-filter';
import { SendDocument } from './send-document';

/**
 * *Documentos* — POOLSE-179, slice 1. What the club has on file for each child,
 * as a status, limited to the papers of the sports the child is in, and the
 * club's own forms filled in. A screen deeper in, so it has its own *Voltar*.
 *
 * Icons, not words (Rui, 06-11-2026): a plus sends and an arrow downloads, each
 * named to a screen reader. The boletim is download only.
 *
 * Slice 2: a paper can be sent from here. It waits for the office (*Enviado — a
 * aguardar a secretaria*) and changes nothing on file until the office accepts
 * it. An ID photo is never shown back, only its status.
 */
const ICON =
  'inline-flex h-control w-control shrink-0 items-center justify-center rounded-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default async function FamilyDocuments({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { child } = await searchParams;
  const query = child === undefined ? '' : `?child=${encodeURIComponent(child)}`;

  let answer: { children: AppChildDocuments[]; family: { id: string; name: string }[] };
  try {
    answer = await apiFetch(`/app/documents${query}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const several = answer.children.length > 1;

  const printHref = (id: string, row: AppDocumentRow): string => {
    const print = row.print!;
    if (print.path === 'boletim') return `/app/familia/documentos/${id}/boletim/pdf`;
    const params = new URLSearchParams();
    if (print.seasonId !== null) params.set('season', print.seasonId);
    if (print.minor) params.set('minor', '1');
    return `/app/familia/documentos/${id}/fpn/pdf?${params.toString()}`;
  };

  const status = (row: AppDocumentRow): string => {
    if (row.status === 'missing') return t('app.documents.status.missing');
    if (row.status === 'expired') return t('app.documents.status.expired');
    if (row.status === 'sent') return t('app.documents.status.sent');
    return row.validUntil === null
      ? t('app.documents.status.ok')
      : t('app.documents.status.okUntil', { date: formatDate(row.validUntil) });
  };

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

      <h1 className="text-xl font-semibold tracking-tight">{t('app.documents.title')}</h1>
      <ChildFilter base="/app/familia/documentos" children={answer.family} chosen={child} />

      {answer.children.length === 0 && <p className="text-foreground-muted">{t('app.family.nobody')}</p>}

      {answer.children.map((one) => (
        <section key={one.id} className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
          {several && <h2 className="font-bold">{one.name}</h2>}
          <ul className="flex flex-col divide-y divide-border">
            {one.documents.map((row) => {
              const kind = t(`app.documents.kind.${row.kind}`);
              const heading = (
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{kind}</span>
                  {/* The boletim is only ever downloaded, so it has no state to report. */}
                  {row.kind !== 'socio_form' && (
                    <span className={`text-sm ${row.status === 'ok' ? 'text-success' : 'font-medium text-warning'}`}>
                      {status(row)}
                    </span>
                  )}
                </span>
              );
              const download = row.print !== null && (
                // A plain anchor to a real file (POOLSE-193), never prefetched:
                // opening it reads, and may decrypt, the child's details, and the
                // read is audited.
                <a
                  href={printHref(one.id, row)}
                  download
                  aria-label={t('app.documents.download', { kind })}
                  className={ICON}
                >
                  <Download className="size-5" aria-hidden />
                </a>
              );
              // POOLSE-193: the FPN form is checked before it is taken, so its
              // download and its sending live on the review.
              if (row.kind === 'fpn_declaration' && row.print !== null) {
                return (
                  <li key={row.kind} className="flex flex-col gap-1 py-2">
                    <Link
                      href={`/app/familia/documentos/${one.id}/fpn/rever`}
                      aria-label={t('app.documents.review.open', { kind })}
                      className="flex min-h-control items-center justify-between gap-3"
                    >
                      {heading}
                      <ChevronRight aria-hidden className="size-5 shrink-0 text-primary" />
                    </Link>
                    {row.incomplete && (
                      <span className="text-sm text-foreground-muted">{t('app.documents.review.incomplete')}</span>
                    )}
                  </li>
                );
              }
              return (
                <li key={row.kind} className="flex flex-col gap-1 py-2">
                  {row.canSend ? (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                        {heading}
                        <span className="flex shrink-0 items-center gap-1">
                          {download}
                          <span className={ICON}>
                            <Plus className="size-5 transition-transform group-open:rotate-45" aria-hidden />
                            <span className="sr-only">
                              {t(row.status === 'missing' ? 'app.documents.send.open' : 'app.documents.send.openAgain', { kind })}
                            </span>
                          </span>
                        </span>
                      </summary>
                      <div className="pt-2">
                        <SendDocument child={one.id} kind={row.kind} />
                      </div>
                    </details>
                  ) : (
                    <div className="flex min-h-control items-center justify-between gap-3">
                      {heading}
                      {download}
                    </div>
                  )}
                  {row.notConfigured && (
                    <span className="text-sm text-foreground-muted">{t('app.documents.notConfigured')}</span>
                  )}
                  {row.awaitsDate === true && (
                    <span className="text-sm text-foreground-muted">{t('app.documents.review.awaitsDate')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
