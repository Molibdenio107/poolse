import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { today } from '@/lib/dates';
import { outcome } from '@/lib/load-failure';
import { countryName } from '@/lib/countries';
import { PageError } from '@/components/page-shell';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from '@/components/auto-print';

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
}

/**
 * The *boletim de sócio*, filled from the record — POOLSE-134 (Rui,
 * 30-10-2026). Poolse's own clean A4 with the club's name: every field is the
 * record's or the sócio columns, the form holds nothing of its own, and the
 * SNS number is never on it. A blank prints as a line to fill by hand. Signed
 * on paper and filed back on the record's Mensalidades tab. `print=1` opens
 * the dialog on arrival.
 */
export default async function BoletimPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
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
  const marital = data.maritalStatus === null ? null : t(`students.identity.marital.${data.maritalStatus}`);
  const address = [data.addressLine, [data.postalCode, data.locality].filter(Boolean).join(' ')]
    .filter((part) => part !== null && part !== '')
    .join(', ');

  const rows: [string, string | null][] = [
    [t('boletim.field.name'), data.name],
    [t('boletim.field.birthDate'), data.birthDate === null ? null : formatDate(data.birthDate)],
    [t('boletim.field.taxNumber'), data.taxNumber],
    [t('students.identity.nationality'), data.nationality === null ? null : countryName(data.nationality, locale)],
    [t('students.identity.birthplace'), data.birthplace],
    [t('students.identity.parentOneName'), data.parentOneName],
    [t('students.identity.parentTwoName'), data.parentTwoName],
    [t('students.identity.maritalStatus'), marital],
    [t('students.identity.profession'), data.profession],
    [t('students.identity.education'), data.education],
    [t('students.identity.addressLine'), address === '' ? null : address],
    [t('boletim.field.phone'), data.contactPhone],
    [t('boletim.field.email'), data.contactEmail],
  ];

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 text-[10.5pt] leading-relaxed text-black print:max-w-none print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 18mm 18mm 16mm; }
      `}</style>

      {print === '1' && <AutoPrint />}

      <div className="mb-6 print:hidden">
        <PrintButton label={t('export.pdf.printLabel')} />
      </div>

      <header className="flex items-baseline justify-between gap-4 border-b border-black pb-3">
        <div>
          <p className="font-bold">{data.clubName}</p>
          <h1 className="mt-1 text-[14pt] font-bold">{t('boletim.title')}</h1>
        </div>
        <dl className="text-right">
          <div>
            <dt className="inline">{t('boletim.field.socioNumber')}: </dt>
            <dd className="inline">
              <Blank value={data.socioNumber} />
            </dd>
          </div>
          <div>
            <dt className="inline">{t('boletim.field.socioSince')}: </dt>
            <dd className="inline">
              <Blank value={data.socioSince === null ? null : formatDate(data.socioSince)} />
            </dd>
          </div>
        </dl>
      </header>

      <table className="mt-5 w-full border-collapse">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-black/40">
              <th scope="row" className="w-[55mm] py-2 pr-3 text-left align-top font-normal">
                {label}
              </th>
              <td className="py-2 align-top">
                <Blank value={value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.minor && (
        <section className="mt-6">
          <h2 className="font-bold">{t('boletim.guardianTitle')}</h2>
          <table className="mt-2 w-full border-collapse">
            <tbody>
              {(
                [
                  [t('boletim.field.name'), data.guardian?.name ?? null],
                  [t('boletim.field.relationship'), data.guardian?.relationship ?? null],
                  [t('boletim.field.phone'), data.guardian?.phone ?? null],
                  [t('boletim.field.email'), data.guardian?.email ?? null],
                ] as [string, string | null][]
              ).map(([label, value]) => (
                <tr key={label} className="border-b border-black/40">
                  <th scope="row" className="w-[55mm] py-2 pr-3 text-left align-top font-normal">
                    {label}
                  </th>
                  <td className="py-2 align-top">
                    <Blank value={value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="mt-8 text-justify">{t('boletim.declaration', { club: data.clubName })}</p>

      <div className="mt-10 grid grid-cols-2 gap-10">
        <p>
          {t('boletim.date')}: {formatDate(today())}
        </p>
        <p>
          {t(data.minor ? 'boletim.signatureGuardian' : 'boletim.signature')}:
          <span className="mt-6 block border-b border-black">&nbsp;</span>
        </p>
      </div>
    </main>
  );
}

/** A filled value as written; an empty one a line to fill by hand. */
function Blank({ value }: { value: string | null }): React.ReactElement {
  if (value === null || value.trim() === '') return <span>______________________________</span>;
  return <span>{value}</span>;
}
