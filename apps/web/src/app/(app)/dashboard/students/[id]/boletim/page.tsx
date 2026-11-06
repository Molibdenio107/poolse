import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { today } from '@/lib/dates';
import { outcome } from '@/lib/load-failure';
import { boletimFormValues, type BoletimPrint } from '@/lib/form-values';
import { PageError } from '@/components/page-shell';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from '@/components/auto-print';
import { BoletimSheet, placementStyle } from '@/components/boletim-sheet';
import { fileUrl } from '@/lib/files';
import { boletimValue, type BoletimPlacement } from '@poolse/rules';

/**
 * The *boletim de sócio*, filled in on the club's own form — POOLSE-134,
 * POOLSE-142. **Only on the club's form** (Rui, 01-11-2026): Poolse no longer
 * composes a boletim of its own, so a club that has not set its form up gets a
 * sentence saying where, not a page to print. `print=1` opens the dialog once
 * the form's image has arrived.
 */
export default async function BoletimPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const { print } = await searchParams;

  const loaded = await outcome(apiFetch<BoletimPrint>(`/students/${id}/boletim`));
  if (loaded.state === 'failed' && loaded.status === 404) notFound();
  if (loaded.state !== 'ok') {
    return (
      <main className="p-6">
        <PageError message={t(loaded.state === 'refused' ? 'common.notAllowed' : loaded.failure.key)} />
      </main>
    );
  }
  const data = loaded.data;
  if (data.template === null || data.template.fields.length === 0) {
    return (
      <main className="p-6">
        <PageError message={t('boletimTemplate.notConfigured', { form: t('boletimTemplate.kind.socio_form') })} />
      </main>
    );
  }
  return <ClubForm data={{ ...data, template: data.template }} autoPrint={print === '1'} />;
}

/**
 * The club's own form, filled in — POOLSE-142. The image is the page (A4, no
 * margin: the scan carries its own), each placed field written at its spot by
 * `placementStyle`, the rule the editor uses. A paper form of a Portuguese club
 * is Portuguese whoever prints it, so the words are pt-PT, as the Anexo 2's are.
 */
async function ClubForm({
  data,
  autoPrint,
}: {
  data: BoletimPrint & { template: { fileId: string; fields: BoletimPlacement[] } };
  autoPrint: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const pt = await getTranslations({ locale: 'pt-PT' });
  const template = data.template;
  const values = boletimFormValues(data, pt);
  const day = today();

  return (
    <main className="mx-auto max-w-[210mm] bg-white text-black print:max-w-none">
      <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
      {autoPrint && <AutoPrint />}
      <div className="flex flex-wrap items-center gap-4 p-6 print:hidden">
        <PrintButton label={t('export.pdf.printLabel')} />
      </div>
      <BoletimSheet imageUrl={fileUrl(template.fileId)!} alt={t('boletimTemplate.kind.socio_form')} className="w-[210mm]">
        {template.fields.map((placement, index) => {
          const text = boletimValue(placement.field, values, day);
          if (text === null) return null;
          return (
            <span key={index} style={placementStyle(placement)} className="absolute whitespace-nowrap">
              {text}
            </span>
          );
        })}
      </BoletimSheet>
    </main>
  );
}
