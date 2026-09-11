import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/page-shell';
import { backTarget } from '@/lib/back';
import { centsToText } from '@/lib/energy-invoice';
import { getInvoice } from '../../../invoice.actions';
import { ArchiveInvoice } from './archive-invoice';

/**
 * One bill, as filed: header, what the dial said, what was charged.
 *
 * Read-only by design. A bill is a document somebody else issued; a figure
 * typed wrong is removed and filed again, exactly as a reading is, so the only
 * control is *Remover*.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ meterId: string; invoiceId: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const { meterId, invoiceId } = await params;
  const { from } = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();

  const detail = await getInvoice(invoiceId);
  if (detail === null || detail.invoice.meterId !== meterId) notFound();
  const { invoice, canArchive } = detail;

  const back = backTarget(from, `/dashboard/facilities/energy/${meterId}`);
  const euros = (cents: number | null): string => (cents === null ? '—' : `${centsToText(cents)} €`);
  const day = (iso: string | null): string => (iso === null ? '—' : format.dateTime(new Date(`${iso}T00:00:00`), 'short'));

  return (
    <PageShell
      title={t('energy.invoice.title', { number: invoice.invoiceNumber })}
      subtitle={`${invoice.supplier} · ${invoice.meterName}`}
      back={{ href: back.href, label: t(back.labelKey) }}
    >
      <section className="rounded border border-border bg-surface p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label={t('energy.invoice.period')} value={`${day(invoice.periodStart)} – ${day(invoice.periodEnd)} · ${t('energy.invoice.days', { days: invoice.days })}`} />
          <Item label={t('energy.invoice.issuedOn')} value={day(invoice.issuedOn)} />
          <Item label={t('energy.invoice.dueOn')} value={day(invoice.dueOn)} />
          <Item label={t('energy.invoice.billedKwh')} value={`${format.number(invoice.kwh, { maximumFractionDigits: 1 })} kWh`} />
          <Item label={t('energy.invoice.subtotal')} value={euros(invoice.subtotalCents)} />
          <Item label={t('energy.invoice.vat')} value={euros(invoice.vatCents)} />
          <Item label={t('energy.invoice.total')} value={euros(invoice.totalCents)} strong />
          <Item label={t('energy.invoice.documentTotal')} value={`${euros(invoice.documentTotalCents)} (${t('energy.invoice.otherChargesShort', { amount: euros(invoice.otherChargesCents) })})`} />
          <Item label={t('energy.invoice.contractedPower')} value={invoice.contractedPowerKva === null ? '—' : `${invoice.contractedPowerKva} kVA`} />
          <Item label={t('energy.invoice.tariff')} value={[invoice.tariff, invoice.cycle].filter(Boolean).join(' · ') || '—'} />
          <Item label={t('energy.invoice.readingQuality')} value={invoice.readingQuality === null ? '—' : t(`energy.invoice.${invoice.readingQuality}`)} />
          <Item label={t('energy.invoice.networkAccess')} value={euros(invoice.networkAccessCents)} />
          <Item label={t('energy.invoice.regulatedDifference')} value={euros(invoice.regulatedDifferenceCents)} />
          <Item label={t('energy.invoice.atcud')} value={invoice.atcud ?? '—'} />
          <Item label={t('energy.invoice.documentReference')} value={invoice.documentReference ?? '—'} />
          <Item
            label={t('energy.invoice.source')}
            value={
              invoice.source === 'import'
                ? t('energy.invoice.sourceImport', { file: invoice.sourceFileName ?? '' })
                : t('energy.invoice.sourceManual', { name: invoice.recordedByName ?? '—' })
            }
          />
        </dl>
        {invoice.notes !== null && <p className="mt-4 text-sm text-foreground-muted">{invoice.notes}</p>}
      </section>

      {invoice.registers.length > 0 && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('energy.invoice.registersTitle')}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted">
                <th className="py-1 font-medium">{t('energy.invoice.register')}</th>
                <th className="py-1 text-right font-medium">{t('energy.invoice.previousIndex')}</th>
                <th className="py-1 text-right font-medium">{t('energy.invoice.currentIndex')}</th>
                <th className="py-1 text-right font-medium">kWh</th>
              </tr>
            </thead>
            <tbody>
              {invoice.registers.map((r) => (
                <tr key={r.register} className="border-t border-border">
                  <td className="py-1">{t(`energy.invoice.registers.${r.register}`)}</td>
                  <td className="py-1 text-right tabular-nums">{r.previousIndex ?? '—'}</td>
                  <td className="py-1 text-right tabular-nums">{r.currentIndex ?? '—'}</td>
                  <td className="py-1 text-right tabular-nums">{format.number(r.kwh, { maximumFractionDigits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.invoice.linesTitle')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted">
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.description')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.period')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('energy.invoice.quantity')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('energy.invoice.unitPrice')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('energy.invoice.amount')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('energy.invoice.discount')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('energy.invoice.lineTotal')}</th>
                <th className="py-1 text-right font-medium">IVA</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 pr-2">
                    <span className="mr-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground-muted">{t(`energy.invoice.kinds.${l.kind}`)}</span>
                    {l.description}
                    {(l.fromOn !== null || l.toOn !== null) && (
                      <span className="block text-xs text-foreground-muted">{day(l.fromOn)} – {day(l.toOn)}</span>
                    )}
                  </td>
                  <td className="py-1 pr-2">{l.period === null ? '—' : t(`energy.invoice.periods.${l.period}`)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.quantity === null ? '—' : `${format.number(l.quantity, { maximumFractionDigits: 3 })} ${l.unit ?? ''}`}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.unitPrice === null ? '—' : `${format.number(l.unitPrice, { maximumFractionDigits: 6 })} €`}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{euros(l.amountCents)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.discountCents === 0 ? '—' : euros(-l.discountCents)}</td>
                  <td className="py-1 pr-2 text-right font-medium tabular-nums">{euros(l.totalCents)}</td>
                  <td className="py-1 text-right tabular-nums">{l.vatRate === null ? '—' : `${l.vatRate} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canArchive && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-5">
          <span className="text-sm text-foreground-muted">{t('energy.invoice.removeHint')}</span>
          <ArchiveInvoice invoiceId={invoice.id} meterId={meterId} facilityId={invoice.facilityId} />
        </section>
      )}
    </PageShell>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd className={strong ? 'font-medium' : ''}>{value}</dd>
    </div>
  );
}
