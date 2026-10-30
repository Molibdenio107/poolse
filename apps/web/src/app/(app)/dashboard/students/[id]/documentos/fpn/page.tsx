import { Fragment } from 'react';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { today } from '@/lib/dates';
import { outcome } from '@/lib/load-failure';
import {
  FPN_DISCIPLINES,
  fpnFormFor,
  fpnSeasonLabel,
  formPieces,
  type FpnPrint,
} from '@/lib/fpn-forms';
import { PageError } from '@/components/page-shell';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from '@/components/auto-print';

/**
 * The FPN's *Anexo 2 — Declaração de Consentimento Informado*, filled from the
 * record — POOLSE-132.
 *
 * **A document, not a screen**: black on white on A4, the browser's "Guardar
 * como PDF", its own components. **Always in Portuguese**: it is the FPN's form
 * reproduced, so its words come from `lib/fpn-forms.ts` whatever the reader's
 * language; only the print button around it is the reader's. No FPN logos.
 *
 * A field the record lacks prints as the form's own underscore line, so a
 * missing postal code never stops the print — it is filled in by hand. Dates
 * on the paper are dd/MM/yyyy, as the FPN's form writes them.
 *
 * Reading it decrypts the ID number, which the API writes to the audit log —
 * so it is a plain anchor opened in a new tab, never prefetched. `print=1`
 * opens the dialog on arrival.
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
  const form = fpnFormFor(data.seasonName);
  const season = fpnSeasonLabel(data.seasonName);

  /** The FPN's own date shape on its own form. */
  const paperDate = (iso: string | null): string | null =>
    iso === null ? null : formatDate(iso).replaceAll('-', '/');

  const values: Record<string, string | null> = {
    signer: data.signerName === '' ? null : data.signerName,
    address: data.addressLine,
    locality: data.locality,
    postalCode: data.postalCode,
    number: data.idDocumentNumber,
    issuedOn: paperDate(data.issuedOn),
    validUntil: paperDate(data.validUntil),
    student: data.studentName,
  };
  const shapes: Record<string, string> = { issuedOn: '__/__/____', validUntil: '__/__/____' };

  const render = (template: string): React.ReactNode =>
    formPieces(template).map((piece, index) => {
      if (piece.kind === 'text') return <Fragment key={index}>{piece.text}</Fragment>;
      if (piece.kind === 'bold') return <strong key={index}>{piece.text}</strong>;
      if (piece.name === 'guardianOf') {
        return data.minor ? <Fragment key={index}>{render(form.guardianOf)}</Fragment> : null;
      }
      // The season is part of the sentence, not a blank to sign against.
      if (piece.name === 'season') return <Fragment key={index}>{season ?? '__________'}</Fragment>;
      return <Blank key={index} value={values[piece.name] ?? null} empty={shapes[piece.name]} />;
    });

  const ticked = new Set(data.disciplines);

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 text-[10.5pt] leading-relaxed text-black print:max-w-none print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 18mm 18mm 16mm; }
      `}</style>

      {query.print === '1' && <AutoPrint />}

      <div className="mb-6 print:hidden">
        <PrintButton label={t('export.pdf.printLabel')} />
      </div>

      <header className="text-center">
        <p className="font-bold">{form.annex}</p>
        <h1 className="mt-1 text-[12pt] font-bold">{form.title}</h1>
      </header>

      <div className="mt-6 flex flex-col gap-3 text-justify">
        <p>{render(form.identity)}</p>
        <p>{render(form.privacy)}</p>
        <p>{render(form.image)}</p>
      </div>

      <section className="mt-5">
        <p>{form.tickLabel}</p>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {FPN_DISCIPLINES.map((discipline) => (
            <li key={discipline} className="inline-flex items-center gap-1.5">
              <Box ticked={ticked.has(discipline)} />
              {form.boxes[discipline]}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span>
          {form.association} <Blank value={data.association} />
        </span>
        <span>
          {form.club} <Blank value={data.clubCode} />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Box ticked={false} />
          {form.individual}
        </span>
      </p>

      <p className="mt-5">
        {form.placeDate} <Blank value={data.place} />, {paperDate(today())}
      </p>

      <p className="mt-8">
        {form.signature} <span className="inline-block w-[90mm] border-b border-black align-baseline">&nbsp;</span>
      </p>

      <p className="mt-8 text-[9pt] text-justify">{form.note}</p>
      <p className="mt-3 font-bold">{form.closing}</p>
    </main>
  );
}

/** A filled blank reads underlined; an empty one is the form's own line. */
function Blank({ value, empty = '______________' }: { value: string | null; empty?: string | undefined }): React.ReactElement {
  if (value === null || value.trim() === '') return <span>{empty}</span>;
  return <span className="underline decoration-1 underline-offset-2">{value}</span>;
}

function Box({ ticked }: { ticked: boolean }): React.ReactElement {
  return (
    <span className="inline-flex size-[4mm] items-center justify-center border border-black text-[8pt] font-bold leading-none">
      {ticked ? 'X' : ''}
    </span>
  );
}
