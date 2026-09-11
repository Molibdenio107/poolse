import type pg from 'pg';

/**
 * Demo energy for the club — slice 5.3.
 *
 * Three meters at the first site, a year of monthly dial readings on two of
 * them, and a year of EDP-shaped bills on the general meter, so the Energia
 * screen, a meter's page, a bill's page and the dashboard's cost panel can be
 * looked at rather than reasoned about.
 *
 * Same three rules as the main seed: additive (every insert checks first),
 * re-runnable (matched on natural keys — a meter's name, a bill's number, a
 * reading's instant), development only (the caller's guard). Runs as the
 * owner, so it writes across RLS.
 *
 * The figures are a small municipal pool's: 9–14 MWh a month on the general
 * supply, more in winter, with a tetra-horário tariff (ponta, cheias, vazio
 * normal, super vazio) and the power priced per day — the shape a real bill
 * has, so the screens meet realistic line counts and totals.
 */

export interface EnergyCounts {
  meters: number;
  readings: number;
  invoices: number;
}

const CPE = 'PT0002000012345678AB';
const SERIAL = '28202100555555';

/** Seasonal factor per calendar month (Jan = 0): a heated pool costs most in winter. */
const SEASON = [1.25, 1.2, 1.1, 0.95, 0.85, 0.8, 0.8, 0.85, 0.9, 1.0, 1.15, 1.25];

/** €/kWh by tariff period, roughly a 2026 BTE contract. */
const PRICES = { ponta: 0.1912, cheias: 0.1588, vazio_normal: 0.1104, super_vazio: 0.0951 } as const;
/** How a month's kWh splits across the periods for a pool that runs its pumps overnight. */
const SPLIT = { ponta: 0.18, cheias: 0.42, vazio_normal: 0.25, super_vazio: 0.15 } as const;
const POWER_KVA = 41.4;
const POWER_PER_DAY = 0.6213;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function seedEnergy(client: pg.Client, organizationId: string): Promise<EnergyCounts> {
  const counts: EnergyCounts = { meters: 0, readings: 0, invoices: 0 };

  const site = await client.query<{ id: string }>(
    `SELECT id FROM facility WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
    [organizationId],
  );
  const facilityId = site.rows[0]?.id;
  if (facilityId === undefined) return counts;

  const pool = await client.query<{ id: string }>(
    `SELECT id FROM pool WHERE organization_id = $1 AND facility_id = $2 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
    [organizationId, facilityId],
  );
  const poolId = pool.rows[0]?.id ?? null;

  // -------------------------------------------------------------------------
  // Meters
  // -------------------------------------------------------------------------

  async function meter(
    name: string,
    kind: string,
    reads: string,
    initialIndex: number | null,
    forPool: boolean,
    cpe: string | null,
    serial: string | null,
  ): Promise<string> {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM energy_meter
        WHERE organization_id = $1 AND facility_id = $2 AND lower(name) = lower($3) AND archived_at IS NULL`,
      [organizationId, facilityId, name],
    );
    if (existing.rows[0] !== undefined) return existing.rows[0].id;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO energy_meter
         (organization_id, facility_id, pool_id, name, kind, unit, reads, initial_index, cpe, serial)
       VALUES ($1, $2, $3, $4, $5::energy_meter_kind, 'kWh', $6::energy_meter_reads, $7, $8, $9)
       RETURNING id`,
      [organizationId, facilityId, forPool ? poolId : null, name, kind, reads, initialIndex, cpe, serial],
    );
    counts.meters += 1;
    return inserted.rows[0]!.id;
  }

  const general = await meter('Geral', 'total', 'cumulative_index', 1_284_310, false, CPE, SERIAL);
  const heating = await meter('Bomba de calor', 'heating', 'cumulative_index', 402_115, true, null, null);
  await meter('Fatura da iluminação exterior', 'lighting', 'interval_consumption', null, false, null, null);

  // -------------------------------------------------------------------------
  // Thirteen monthly readings on the two dials, first of each month at 08:00
  // -------------------------------------------------------------------------

  const now = new Date();
  const months: { at: Date; kwh: number }[] = [];
  let index = 1_284_310;
  for (let back = 12; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, 8));
    const kwh = Math.round(11_000 * SEASON[at.getUTCMonth()]! + ((back * 37) % 900) - 450);
    months.push({ at, kwh });
    index += kwh;
  }

  async function reading(meterId: string, at: Date, value: number): Promise<void> {
    const done = await client.query(
      `INSERT INTO energy_reading (organization_id, meter_id, taken_at, value, source)
       VALUES ($1, $2, $3, $4, 'manual')
       ON CONFLICT (organization_id, meter_id, taken_at) DO NOTHING`,
      [organizationId, meterId, at.toISOString(), value],
    );
    counts.readings += done.rowCount ?? 0;
  }

  // The dial reads the running index; the first reading is the initial index
  // plus the first month, so every month yields a delta.
  let generalIndex = 1_284_310;
  let heatingIndex = 402_115;
  for (const m of months) {
    generalIndex += m.kwh;
    heatingIndex += Math.round(m.kwh * 0.48);
    await reading(general, m.at, generalIndex);
    await reading(heating, m.at, heatingIndex);
  }

  // -------------------------------------------------------------------------
  // Twelve EDP-shaped bills on the general supply, one per completed month
  // -------------------------------------------------------------------------

  let registers = { ponta: 231_400, cheias: 539_800, vazio_normal: 321_300, super_vazio: 191_810 };

  for (let i = 0; i < months.length - 1; i += 1) {
    const from = months[i]!.at;
    const to = new Date(months[i + 1]!.at.getTime() - 24 * 3600 * 1000);
    const kwh = months[i + 1]!.kwh;
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000)) + 1;
    const issued = new Date(to.getTime() + 5 * 24 * 3600 * 1000);
    const due = new Date(issued.getTime() + 25 * 24 * 3600 * 1000);
    const number = `FT${issued.getUTCFullYear()} K3401/3400${String(100_000 + i).slice(1)}`;

    const exists = await client.query(
      `SELECT 1 FROM energy_invoice WHERE organization_id = $1 AND lower(supplier) = 'edp comercial' AND lower(invoice_number) = lower($2) AND archived_at IS NULL`,
      [organizationId, number],
    );
    if (exists.rowCount) continue;

    // Lines: four energy periods, power, two taxes. Cents, rounded per line as a bill does.
    const lines: {
      kind: string; description: string; period: string | null; quantity: number; unit: string;
      unitPrice: number; amountCents: number; totalCents: number; vatRate: number;
    }[] = [];
    const periodKwh: Record<keyof typeof SPLIT, number> = { ponta: 0, cheias: 0, vazio_normal: 0, super_vazio: 0 };
    let allocated = 0;
    for (const period of ['ponta', 'cheias', 'vazio_normal'] as const) {
      periodKwh[period] = Math.round(kwh * SPLIT[period]);
      allocated += periodKwh[period];
    }
    periodKwh.super_vazio = kwh - allocated;
    const LABEL = { ponta: 'Ponta', cheias: 'Cheias', vazio_normal: 'Vazio Normal', super_vazio: 'Super Vazio' } as const;
    for (const period of ['ponta', 'cheias', 'vazio_normal', 'super_vazio'] as const) {
      const cents = Math.round(periodKwh[period] * PRICES[period] * 100);
      lines.push({
        kind: 'energy', description: `Consumo real ${LABEL[period]}`, period, quantity: periodKwh[period],
        unit: 'kWh', unitPrice: PRICES[period], amountCents: cents, totalCents: cents, vatRate: 23,
      });
    }
    const power = Math.round(POWER_KVA * POWER_PER_DAY * days * 100);
    lines.push({ kind: 'power', description: `Potência (${POWER_KVA} kVA)`, period: null, quantity: days, unit: 'dias', unitPrice: POWER_PER_DAY, amountCents: power, totalCents: power, vatRate: 23 });
    lines.push({ kind: 'tax', description: 'DGEG', period: null, quantity: 1, unit: 'mês', unitPrice: 0.07, amountCents: 7, totalCents: 7, vatRate: 23 });
    const iec = Math.round(kwh * 0.001 * 100);
    lines.push({ kind: 'tax', description: 'IEC', period: null, quantity: kwh, unit: 'kWh', unitPrice: 0.001, amountCents: iec, totalCents: iec, vatRate: 23 });

    const subtotal = lines.reduce((sum, l) => sum + l.totalCents, 0);
    const vat = Math.round(subtotal * 0.23);
    const total = subtotal + vat;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO energy_invoice
         (organization_id, meter_id, supplier, invoice_number, atcud, document_reference,
          issued_on, period_start, period_end, due_on, contracted_power_kva, tariff, cycle, reading_quality,
          subtotal_cents, vat_cents, total_cents, other_charges_cents, document_total_cents,
          network_access_cents, source, notes)
       VALUES ($1, $2, 'EDP Comercial', $3, $4, $5, $6, $7, $8, $9, $10, 'BTE Tetra-horário', 'Ciclo semanal', 'real',
               $11, $12, $13, 0, $13, $14, 'manual', 'Dados de demonstração (seed).')
       RETURNING id`,
      [
        organizationId, general, number, `DEMO${String(1000 + i)}-3400${String(100_000 + i).slice(1)}`, `C801DEMO${String(100_000 + i)}`,
        isoDay(issued), isoDay(from), isoDay(to), isoDay(due), POWER_KVA,
        subtotal, vat, total, Math.round(subtotal * 0.38),
      ],
    );
    const invoiceId = inserted.rows[0]!.id;

    for (const period of ['ponta', 'cheias', 'vazio_normal', 'super_vazio'] as const) {
      const register = period === 'vazio_normal' ? 'vazio' : period;
      const previous = registers[period];
      registers = { ...registers, [period]: previous + periodKwh[period] };
      await client.query(
        `INSERT INTO energy_invoice_register (organization_id, invoice_id, register, previous_index, current_index, kwh)
         VALUES ($1, $2, $3::energy_register, $4, $5, $6)`,
        [organizationId, invoiceId, register, previous, previous + periodKwh[period], periodKwh[period]],
      );
    }

    for (const [position, l] of lines.entries()) {
      await client.query(
        `INSERT INTO energy_invoice_line
           (organization_id, invoice_id, position, kind, description, period, from_on, to_on,
            quantity, unit, unit_price, amount_cents, discount_cents, total_cents, vat_rate)
         VALUES ($1, $2, $3, $4::energy_line_kind, $5, $6::energy_tariff_period, $7, $8, $9, $10, $11, $12, 0, $13, $14)`,
        [
          organizationId, invoiceId, position, l.kind, l.description, l.period,
          l.kind === 'tax' ? null : isoDay(from), l.kind === 'tax' ? null : isoDay(to),
          l.quantity, l.unit, l.unitPrice, l.amountCents, l.totalCents, l.vatRate,
        ],
      );
    }
    counts.invoices += 1;
  }

  return counts;
}
