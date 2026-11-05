import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Printer } from 'lucide-react';
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
 * Slice 2: a paper can be sent from here. It waits for the office (*Enviado — a
 * aguardar a secretaria*) and changes nothing on file until the office accepts
 * it. An ID photo is never shown back, only its status.
 */
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
    if (print.path === 'boletim') return `/app/familia/documentos/${id}/boletim`;
    const params = new URLSearchParams();
    if (print.seasonId !== null) params.set('season', print.seasonId);
    if (print.minor) params.set('minor', '1');
    return `/app/familia/documentos/${id}/fpn?${params.toString()}`;
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
        href={`/app/familia/aulas${query}`}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('app.family.backToLessons')}
        <LinkBusy />
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{t('app.documents.title')}</h1>
      <ChildFilter base="/app/familia/documentos" children={answer.family} chosen={child} />

      {answer.children.length === 0 && <p className="text-foreground-muted">{t('app.family.nobody')}</p>}

      {answer.children.map((one) => (
        <section key={one.id} className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
          {several && <h2 className="font-bold">{one.name}</h2>}
          <ul className="flex flex-col divide-y divide-border">
            {one.documents.map((row) => (
              <li key={row.kind} className="flex flex-col gap-1 py-3">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t(`app.documents.kind.${row.kind}`)}</span>
                  <span className={`shrink-0 text-sm ${row.status === 'ok' ? 'text-success' : 'font-medium text-warning'}`}>
                    {status(row)}
                  </span>
                </span>
                {row.print !== null && (
                  // A plain anchor, never prefetched: opening it reads, and may
                  // decrypt, the child's details, and the read is audited.
                  <a
                    href={printHref(one.id, row)}
                    className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-2 coarse:py-2"
                  >
                    <Printer className="size-4" aria-hidden />
                    {t('app.documents.print')}
                  </a>
                )}
                {row.notConfigured && (
                  <span className="text-sm text-foreground-muted">{t('app.documents.notConfigured')}</span>
                )}
                {row.canSend && (
                  <details className="group">
                    <summary className="inline-flex min-h-control cursor-pointer items-center text-sm font-medium text-primary">
                      {row.status === 'missing' ? t('app.documents.send.open') : t('app.documents.send.openAgain')}
                    </summary>
                    <div className="pt-2">
                      <SendDocument child={one.id} kind={row.kind} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
