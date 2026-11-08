import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { fileUrl } from '@/lib/files';
import { readShell } from '@/lib/shell';
import { LinkBusy } from '@/components/link-busy';
import { InvoicePaper } from '../../../../../dashboard/faturacao/invoice-paper';
import { loadPayerInvoice } from '../load';

/**
 * One *Extrato* on A4 — POOLSE-201. The office's paper (`InvoicePaper`), with
 * *Extrato* for the word and the internal-record notice under the number. The
 * app's header and tabs are `print:hidden`, so only the paper prints.
 *
 * The logo is the shell's, the one the app's corner already shows: the office's
 * `/settings/logo` is not a family's to read.
 */
export default async function PayerInvoicePrint({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const [invoice, shell] = await Promise.all([loadPayerInvoice(id), readShell()]);

  return (
    <>
      <Link
        href={`/app/perfil/extratos/${invoice.id}`}
        aria-label={t('app.invoices.backTo')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 print:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>
      <InvoicePaper invoice={invoice} logo={fileUrl(shell.logoFileId)} kindLabel={t('app.invoices.document')} />
    </>
  );
}
