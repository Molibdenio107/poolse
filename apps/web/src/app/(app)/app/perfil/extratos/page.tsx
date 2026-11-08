import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { ApiError, apiFetch, type AppInvoiceList } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { describeLoad } from '@/lib/load-failure';
import { formatCents } from '@/lib/money';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { StatusBadge } from '../../../dashboard/faturacao/status-badge';

/**
 * *Extratos* — POOLSE-201 (Rui, 08-11-2026). The documents the reader pays,
 * newest first, 20 at a time. A document is the payer's, not the child's, so
 * this lives on *Perfil* beside *Pagamentos*, and lists only what is addressed
 * to the reader — a second guardian who does not pay sees nothing here.
 *
 * Called *Extratos*, never *Faturas*: these are Poolse's internal records, and
 * the certified-invoicing ticket is what renames them.
 */
export default async function PayerInvoices({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const asked = Number((await searchParams).offset ?? '0');
  const offset = Number.isInteger(asked) && asked > 0 ? asked : 0;

  let answer: AppInvoiceList;
  try {
    answer = await apiFetch<AppInvoiceList>(`/app/invoices?offset=${offset}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const previous = offset > 0 ? Math.max(offset - 20, 0) : null;
  const pager = 'inline-flex items-center gap-1.5 text-sm text-primary hover:underline coarse:-my-3 coarse:py-3';

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
      <h1 className="text-xl font-semibold tracking-tight">{t('app.invoices.title')}</h1>

      {answer.documents.length === 0 ? (
        <p className="text-foreground-muted">{t('app.invoices.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded bg-surface px-4 shadow-card">
          {answer.documents.map((one) => (
            <li key={one.id}>
              <Link
                href={`/app/perfil/extratos/${one.id}`}
                className="flex min-h-[52px] items-center justify-between gap-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {one.kind === 'credit_note' && one.correctsDocumentNo !== null
                        ? t('app.invoices.creditNoteOf', { documentNo: one.correctsDocumentNo })
                        : one.documentNo}
                    </span>
                    <StatusBadge status={one.status} daysOverdue={one.daysOverdue} />
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {[formatDate(one.issuedOn), ...(one.students.length > 0
                      ? [new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(one.students)]
                      : [])].join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatCents(locale, one.totalCents)}</span>
                  <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
                </span>
                <LinkBusy />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(previous !== null || answer.next !== null) && (
        <nav className="flex items-center justify-between gap-3">
          {previous !== null ? (
            <Link href={`/app/perfil/extratos?offset=${previous}`} className={pager}>
              {t('app.invoices.newer')}
              <LinkBusy />
            </Link>
          ) : (
            <span />
          )}
          {answer.next !== null && (
            <Link href={`/app/perfil/extratos?offset=${answer.next}`} className={pager}>
              {t('app.invoices.older')}
              <LinkBusy />
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
