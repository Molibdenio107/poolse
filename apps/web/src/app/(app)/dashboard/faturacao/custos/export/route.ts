import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type CostsOverview } from '@/lib/api';
import { toCsv } from '@/lib/csv';
import { today } from '@/lib/dates';
import { formatCents } from '@/lib/money';

/**
 * The month table of *Custos*, as a CSV — POOLSE-183.
 *
 * The same read and the same window as the page, so its totals are the tiles to
 * the cent (QA 7): the API carries the rounding across the months. The API decides
 * who may have it, and an Admin's file leaves the Owner's pay out as the page does.
 */
export async function GET(request: Request): Promise<Response> {
  const asked = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ['ruler', 'window', 'vat']) {
    const value = asked.get(key);
    if (value !== null) query.set(key, value);
  }

  const t = await getTranslations();
  let data: CostsOverview;
  try {
    data = await apiFetch<CostsOverview>(`/costs/overview?${query.toString()}`);
  } catch (error) {
    // Plain text and the real status: a 403 must stay a 403, not a corrupt file.
    const status = error instanceof ApiError ? error.status : 500;
    return new Response(t('costs.exportFailed'), { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const locale = await getLocale();
  const groups = data.totals.map((total) => total.group);
  const money = (cents: number): string => formatCents(locale, cents);
  const body = data.table.map((row) => {
    const cells = groups.map((group) => {
      const cell = row.groups[group];
      return (cell?.invoicedCents ?? 0) + (cell?.estimatedCents ?? 0);
    });
    return [row.month, ...cells.map(money), money(cells.reduce((sum, cents) => sum + cents, 0))];
  });
  const totals = data.totals.map((total) => total.invoicedCents + total.estimatedCents);
  const csv = toCsv([
    [t('costs.month'), ...groups.map((group) => t(`costs.kind.${group}`)), t('costs.total')],
    ...body,
    [t('costs.total'), ...totals.map(money), money(totals.reduce((sum, cents) => sum + cents, 0))],
  ]);

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="poolse-${locale === 'en' ? 'costs' : 'custos'}-${today()}.csv"`,
      'cache-control': 'no-store, private',
    },
  });
}
