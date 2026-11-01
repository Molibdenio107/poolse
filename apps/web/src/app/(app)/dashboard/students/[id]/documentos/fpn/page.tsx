import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { today } from '@/lib/dates';
import { outcome } from '@/lib/load-failure';
import { fpnSeasonLabel, type FpnPrint } from '@/lib/fpn-forms';
import { PageError } from '@/components/page-shell';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from '@/components/auto-print';
import { BoletimSheet, placementStyle } from '@/components/boletim-sheet';
import { fileUrl } from '@/lib/files';
import { boletimValue, type BoletimData, type BoletimPlacement } from '@poolse/rules';

/**
 * The FPN's *Anexo 2 — Declaração de Consentimento Informado*, filled in on the
 * club's own copy of the form — POOLSE-132, POOLSE-142. **Only on the club's
 * form** (Rui, 01-11-2026): Poolse no longer composes the declaration itself,
 * so a club that has not set its adult or minor form up gets a sentence saying
 * where. Reading it decrypts the ID number, which the API writes to the audit
 * log — so it is a plain anchor opened in a new tab, never prefetched.
 * `print=1` opens the dialog once the form's image has arrived.
 */
export default async function FpnDeclarationPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string; minor?: string; print?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const query = await searchParams;

  const request = new URLSearchParams();
  if (query.season !== undefined && /^[0-9a-f-]{36}$/i.test(query.season)) request.set('season', query.season);
  if (query.minor === '1') request.set('minor', '1');
  const loaded = await outcome(apiFetch<FpnPrint>(`/students/${id}/documents/fpn?${request.toString()}`));
  if (loaded.state === 'failed' && loaded.status === 404) notFound();
  if (loaded.state !== 'ok') {
    return (
      <main className="p-6">
        <PageError message={t(loaded.state === 'refused' ? 'common.notAllowed' : loaded.failure.key)} />
      </main>
    );
  }
  const data = loaded.data;
  const template = data.template ?? null;
  if (template === null || template.fields.length === 0) {
    const kind = data.minor ? 'fpn_declaration_minor' : 'fpn_declaration';
    return (
      <main className="p-6">
        <PageError message={t('boletimTemplate.notConfigured', { form: t(`boletimTemplate.kind.${kind}`) })} />
      </main>
    );
  }
  return (
    <ClubFpnForm data={{ ...data, template }} season={fpnSeasonLabel(data.seasonName)} autoPrint={query.print === '1'} />
  );
}

/**
 * The club's own copy of the FPN's form, filled in — POOLSE-142. The same
 * rule as the club's boletim (`BoletimSheet` / `placementStyle`): the image is
 * the page, each placed field written at its spot, the modalidades an X where
 * the student's own Documentos tab ticks them. Portuguese whatever the reader's
 * language, and the ID's dates with slashes, as the FPN's form writes them.
 */
async function ClubFpnForm({
  data,
  season,
  autoPrint,
}: {
  data: FpnPrint & { template: { fileId: string; fields: BoletimPlacement[] } };
  season: string | null;
  autoPrint: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const pt = await getTranslations({ locale: 'pt-PT' });
  const values: BoletimData = {
    name: data.studentName,
    parentOneName: null,
    parentTwoName: null,
    birthDate: null,
    maritalStatus: null,
    profession: null,
    education: null,
    birthplace: null,
    nationality: null,
    addressLine: data.addressLine,
    locality: data.locality,
    postalCode: data.postalCode,
    phone: null,
    email: null,
    taxNumber: null,
    idDocumentNumber: data.idDocumentNumber,
    snsNumber: null,
    socioNumber: null,
    socioSince: null,
    guardian: null,
    fpn: {
      signerName: data.signerName === '' ? null : data.signerName,
      season,
      association: data.association,
      clubCode: data.clubCode,
      place: data.place,
      idDocumentType: data.idDocumentType === null ? null : pt(`documents.idDocument.types.${data.idDocumentType}`),
      issuedOn: data.issuedOn,
      validUntil: data.validUntil,
      disciplines: data.disciplines,
    },
  };
  const day = today();

  return (
    <main className="mx-auto max-w-[210mm] bg-white text-black print:max-w-none">
      <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
      {autoPrint && <AutoPrint />}
      <div className="flex flex-wrap items-center gap-4 p-6 print:hidden">
        <PrintButton label={t('export.pdf.printLabel')} />
      </div>
      <BoletimSheet imageUrl={fileUrl(data.template.fileId)!} alt={t(`boletimTemplate.kind.${data.minor ? 'fpn_declaration_minor' : 'fpn_declaration'}`)} className="w-[210mm]">
        {data.template.fields.map((placement, index) => {
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

