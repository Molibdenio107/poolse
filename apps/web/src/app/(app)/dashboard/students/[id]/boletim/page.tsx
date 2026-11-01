import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { today } from '@/lib/dates';
import { outcome } from '@/lib/load-failure';
import { countryName } from '@/lib/countries';
import { PageError } from '@/components/page-shell';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from '@/components/auto-print';
import { BoletimSheet, placementStyle } from '@/components/boletim-sheet';
import { fileUrl } from '@/lib/files';
import { boletimValue, type BoletimPlacement } from '@poolse/rules';

/** What `GET /students/:id/boletim` returns — POOLSE-134. */
interface BoletimPrint {
  clubName: string;
  socioNumber: string | null;
  socioSince: string | null;
  isSocio: boolean;
  name: string;
  birthDate: string | null;
  taxNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  parentOneName: string | null;
  parentTwoName: string | null;
  maritalStatus: string | null;
  profession: string | null;
  education: string | null;
  birthplace: string | null;
  nationality: string | null;
  minor: boolean;
  guardian: { name: string; phone: string | null; email: string | null; relationship: string | null } | null;
  /** The club's own form (POOLSE-142), or null for Poolse's. */
  template: { fileId: string; fields: BoletimPlacement[] } | null;
  /** Present only when the club's form places it. */
  idDocumentNumber: string | null;
  snsNumber: string | null;
}

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
  const values = {
    name: data.name,
    parentOneName: data.parentOneName,
    parentTwoName: data.parentTwoName,
    birthDate: data.birthDate,
    maritalStatus: data.maritalStatus === null ? null : pt(`students.identity.marital.${data.maritalStatus}`),
    profession: data.profession,
    education: data.education,
    birthplace: data.birthplace,
    nationality: data.nationality === null ? null : countryName(data.nationality, 'pt-PT'),
    addressLine: data.addressLine,
    locality: data.locality,
    postalCode: data.postalCode,
    phone: data.contactPhone,
    email: data.contactEmail,
    taxNumber: data.taxNumber,
    idDocumentNumber: data.idDocumentNumber,
    snsNumber: data.snsNumber,
    socioNumber: data.socioNumber,
    socioSince: data.socioSince,
    guardian: data.guardian,
  };
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
