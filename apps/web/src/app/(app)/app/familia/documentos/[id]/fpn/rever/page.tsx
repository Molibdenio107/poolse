import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Download } from 'lucide-react';
import { ApiError, apiFetch, type AppFpnReview } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { SendDocument } from '../../../send-document';
import { FpnDetailsForm } from './details-form';

/** The person's to fill, and the club's: said apart, because each waits on someone else. */
const CLUB_FIELDS = ['fpnAssociation', 'fpnClubCode'];

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground';

/**
 * Checking the FPN form before signing it — POOLSE-193 (Rui, 06-11-2026). Every
 * value the form prints, the mandatory ones marked, and the download off until they
 * are all there, which the API enforces too. Then it is signed outside Poolse, by
 * hand or with Chave Móvel Digital, and sent back here for the office to review.
 */
export default async function FpnReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;

  let review: AppFpnReview;
  try {
    review = await apiFetch<AppFpnReview>(`/app/documents/fpn?child=${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const label = (key: string): string => t(`app.documents.review.field.${key}` as never);
  const missing = new Set(review.missing);
  const yours = review.missing.filter((key) => !CLUB_FIELDS.includes(key)).map(label);
  const clubs = review.missing.filter((key) => CLUB_FIELDS.includes(key)).map(label);
  const day = (value: string | null): string | null => (value === null ? null : formatDate(value));

  const rows: { key: string; value: string | null; mandatory: boolean }[] = [
    { key: 'signerName', value: review.signerName === '' ? null : review.signerName, mandatory: false },
    { key: 'studentName', value: review.studentName, mandatory: false },
    { key: 'addressLine', value: review.addressLine, mandatory: true },
    { key: 'locality', value: review.locality, mandatory: true },
    { key: 'postalCode', value: review.postalCode, mandatory: true },
    {
      key: 'idDocumentType',
      value: review.idDocumentType === null ? null : t(`documents.idDocument.types.${review.idDocumentType}`),
      mandatory: false,
    },
    { key: 'idDocumentNumber', value: review.idDocumentNumber, mandatory: true },
    { key: 'issuedOn', value: day(review.issuedOn), mandatory: false },
    { key: 'idDocumentValidUntil', value: day(review.validUntil), mandatory: true },
    {
      key: 'disciplines',
      value: review.disciplines.length === 0 ? null : review.disciplines.map((one) => t(`documents.discipline.${one}` as never)).join(', '),
      mandatory: true,
    },
    { key: 'seasonName', value: review.seasonName, mandatory: false },
    { key: 'fpnAssociation', value: review.association, mandatory: true },
    { key: 'fpnClubCode', value: review.clubCode, mandatory: true },
  ];

  const query = new URLSearchParams();
  if (review.print?.seasonId != null) query.set('season', review.print.seasonId);
  if (review.minor) query.set('minor', '1');
  const complete = review.missing.length === 0;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.documents.review.title')}</h1>

      <section className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
        <dl className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col py-2">
              <dt className="text-sm text-foreground-muted">
                {label(row.key)}
                {row.mandatory && (
                  <>
                    <span aria-hidden> *</span>
                    <span className="sr-only"> ({t('app.documents.review.mandatory')})</span>
                  </>
                )}
              </dt>
              <dd className={missing.has(row.key) ? 'font-medium text-warning' : 'break-words'}>
                {row.value ?? (row.mandatory ? t('app.documents.review.empty') : '—')}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {review.status !== 'sent' && (
        <FpnDetailsForm child={id} review={review} open={yours.length > 0} />
      )}

      {yours.length > 0 && (
        <p className="text-sm font-medium text-warning">{t('app.documents.review.yours', { fields: yours.join(', ') })}</p>
      )}
      {clubs.length > 0 && <p className="text-sm">{t('app.documents.review.club', { fields: clubs.join(', ') })}</p>}

      {review.status === 'sent' ? (
        <p className="text-sm font-medium">{t('app.documents.review.sent')}</p>
      ) : (
        <section className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
          {review.status === 'ok' && <p className="text-sm">{t('app.documents.review.done')}</p>}
          {review.notConfigured ? (
            <p className="text-sm text-foreground-muted">{t('app.documents.notConfigured')}</p>
          ) : complete ? (
            // A plain anchor to a real file, never prefetched: the read is audited.
            <a href={`/app/familia/documentos/${id}/fpn/pdf?${query.toString()}`} download className={BUTTON}>
              <Download aria-hidden className="size-5" />
              {t('app.documents.review.download')}
            </a>
          ) : (
            <p className="text-sm text-foreground-muted">{t('app.documents.review.blocked')}</p>
          )}
          {complete && !review.notConfigured && (
            <>
              <p className="text-sm">{t('app.documents.review.sign')}</p>
              {review.canSend && <SendDocument child={id} kind="fpn_declaration" />}
            </>
          )}
        </section>
      )}
    </>
  );
}
