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
 * re-runnable (matched on natural keys — a meter's name, a bill's supply and
 * period, a reading's instant), development only (the caller's guard). Runs as the
 * owner, so it writes across RLS.
 *
 * The figures are a small municipal pool's: 9–14 MWh a month on the general
 * supply, more in winter, with a tetra-horário tariff (ponta, cheias, vazio
 * normal, super vazio) and the power priced per day — the shape a real bill
 * has, so the screens meet realistic line counts and totals.
 *
 * **Cost per use — POOLSE-102.** The first tank's *Custo por utilização* reads
 * the meters whose `pool_id` names it, priced by a tariff (never by a bill,
 * which stays the Energia screen's). So the tank gets a gas boiler meter of its
 * own — a CUI, a year of readings and a year of bills — and both of its meters
 * get a rate: the gas at its bills' contracted price, the heat pump at about
 * the general supply's average, marked *estimated* because a sub-meter has no
 * bill. Lesson hours and bathers come from the main and reference seeds.
 *
 * Everything here is demo data. That is said here and in the seed's output,
 * not on a row a screen shows (POOLSE-102): the new rows carry no note.
 * Amounts follow the calendar month, never `Math.random()`, so a screenshot
 * taken in March looks like every other one taken in March.
 */

export interface EnergyCounts {
  meters: number;
  readings: number;
  invoices: number;
  tariffs: number;
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

/** The boiler's supply point. A CUI has the CPE's shape, and `cpe` holds either. */
const CUI = 'PT1601000000483112GN';
const GAS_SERIAL = 'G25-2019-77310';
const GAS_INITIAL = 856_420;
/** €/kWh of natural gas, escalão 4, and the daily fixed term — a 2026 commercial contract. */
const GAS_PRICE = 0.0905;
const GAS_FIXED_PER_DAY = 0.9871;
const GAS_IEC = 0.00093;
/** The heat pump's rate: about the general supply's average €/kWh over its four periods. */
const HEAT_PUMP_RATE = 0.1712;

/**
 * A month's electricity on the general supply, by calendar month — POOLSE-102.
 * The small wobble is keyed on year and month, so a month always reads the
 * same whenever the seed runs.
 */
function electricityKwh(at: Date): number {
  const month = at.getUTCFullYear() * 12 + at.getUTCMonth();
  return Math.round(11_000 * SEASON[at.getUTCMonth()]! + ((month * 37) % 900) - 450);
}

/**
 * The general supply's four tetra-horário registers at a dial index. Three are
 * the index split by `SPLIT`, the fourth takes the rest, so the four always add
 * to the dial — and a bill's period kWh, read as two of these, chain exactly.
 */
function registersAt(index: number): Record<keyof typeof SPLIT, number> {
  const run = index - 1_284_310;
  const ponta = Math.round(run * SPLIT.ponta);
  const cheias = Math.round(run * SPLIT.cheias);
  const vazio = Math.round(run * SPLIT.vazio_normal);
  return {
    ponta: 231_400 + ponta,
    cheias: 539_800 + cheias,
    vazio_normal: 321_300 + vazio,
    super_vazio: 191_810 + run - ponta - cheias - vazio,
  };
}

/** A month's gas, by calendar month: a boiler's year, heavy in winter and light in summer. */
function gasKwh(at: Date): number {
  const month = at.getUTCMonth();
  return Math.round(16_000 * SEASON[month]! ** 2 + ((month * 61) % 700) - 350);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function seedEnergy(
  client: pg.Client,
  organizationId: string,
  /** Today, for a test that runs the seed as of two different months. */
  now: Date = new Date(),
): Promise<EnergyCounts> {
  const counts: EnergyCounts = { meters: 0, readings: 0, invoices: 0, tariffs: 0 };

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
  // POOLSE-102: the tank's boiler, on a gas supply of its own — only with a tank to name.
  const gas =
    poolId === null
      ? null
      : await meter('Gás natural — caldeira', 'heating', 'cumulative_index', GAS_INITIAL, true, CUI, GAS_SERIAL);

  // -------------------------------------------------------------------------
  // Thirteen monthly readings on the two dials, first of each month at 08:00
  // -------------------------------------------------------------------------

  const months: { at: Date }[] = [];
  for (let back = 12; back >= 0; back -= 1) {
    months.push({ at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, 8)) });
  }

  /*
   * One dial's thirteen readings, continued from whatever is already stored
   * (POOLSE-102). A month's consumption is a function of the calendar month,
   * never of how far back it is from today — the first version counted
   * backwards from today, so a run a month later recomputed every reading, put
   * one below a reading already stored, and the dial trigger refused the seed.
   * A month already read keeps its reading; a month after the last stored one
   * continues from it; a gap behind the last stored one is left alone, because
   * a value there would have to fit between two readings it never saw.
   * Answers each month's dial value, keyed by the month's instant.
   */
  async function dial(meterId: string, initial: number, consumed: (at: Date) => number): Promise<Map<string, number>> {
    const stored = await client.query<{ taken_at: Date; value: string }>(
      `SELECT taken_at, value FROM energy_reading
        WHERE organization_id = $1 AND meter_id = $2 AND archived_at IS NULL
        ORDER BY taken_at`,
      [organizationId, meterId],
    );
    const byInstant = new Map(stored.rows.map((row) => [row.taken_at.toISOString(), Number(row.value)]));
    const latest = stored.rows.at(-1)?.taken_at.getTime() ?? -Infinity;
    const earlier = stored.rows.filter((row) => row.taken_at.getTime() < months[0]!.at.getTime()).at(-1);
    let value = earlier === undefined ? initial : Number(earlier.value);
    const values = new Map<string, number>();
    for (const { at } of months) {
      const key = at.toISOString();
      const known = byInstant.get(key);
      if (known !== undefined) {
        value = known;
        values.set(key, value);
        continue;
      }
      if (at.getTime() < latest) continue;
      value += consumed(at);
      await client.query(
        `INSERT INTO energy_reading (organization_id, meter_id, taken_at, value, source)
         VALUES ($1, $2, $3, $4, 'manual')
         ON CONFLICT (organization_id, meter_id, taken_at) DO NOTHING`,
        [organizationId, meterId, key, value],
      );
      counts.readings += 1;
      values.set(key, value);
    }
    return values;
  }

  /** Whether this supply already has its bill for the period starting `from`. */
  async function billed(meterId: string, from: Date): Promise<boolean> {
    const found = await client.query(
      `SELECT 1 FROM energy_invoice
        WHERE organization_id = $1 AND meter_id = $2 AND period_start = $3 AND archived_at IS NULL`,
      [organizationId, meterId, isoDay(from)],
    );
    return (found.rowCount ?? 0) > 0;
  }

  const generalAt = await dial(general, 1_284_310, electricityKwh);
  await dial(heating, 402_115, (at) => Math.round(electricityKwh(at) * 0.48));
  const gasAt = gas === null ? null : await dial(gas, GAS_INITIAL, gasKwh);

  // -------------------------------------------------------------------------
  // Twelve EDP-shaped bills on the general supply, one per completed month
  // -------------------------------------------------------------------------

  for (let i = 0; i < months.length - 1; i += 1) {
    const from = months[i]!.at;
    const to = new Date(months[i + 1]!.at.getTime() - 24 * 3600 * 1000);
    // The bill says what the dial says: its kWh are the two readings' difference.
    const before = generalAt.get(from.toISOString());
    const after = generalAt.get(months[i + 1]!.at.toISOString());
    if (before === undefined || after === undefined) continue;
    const kwh = after - before;
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000)) + 1;
    const issued = new Date(to.getTime() + 5 * 24 * 3600 * 1000);
    const due = new Date(issued.getTime() + 25 * 24 * 3600 * 1000);
    // Keyed on the billed month, never on its place in the run (POOLSE-102).
    const month = `${from.getUTCFullYear()}${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
    const number = `FT${issued.getUTCFullYear()} K3401/34${month}`;

    // One bill per supply per period: matched on the period, so a bill the
    // first version numbered by position is still found.
    if (await billed(general, from)) continue;

    // Lines: four energy periods, power, two taxes. Cents, rounded per line as a bill does.
    const lines: {
      kind: string; description: string; period: string | null; quantity: number; unit: string;
      unitPrice: number; amountCents: number; totalCents: number; vatRate: number;
    }[] = [];
    // Each period's kWh is its register's movement, so one bill's closing
    // registers are the next one's opening registers, and the four add to `kwh`.
    const opening = registersAt(before);
    const closing = registersAt(after);
    const periodKwh: Record<keyof typeof SPLIT, number> = {
      ponta: closing.ponta - opening.ponta,
      cheias: closing.cheias - opening.cheias,
      vazio_normal: closing.vazio_normal - opening.vazio_normal,
      super_vazio: closing.super_vazio - opening.super_vazio,
    };
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
               $11, $12, $13, 0, $13, $14, 'manual', NULL)
       RETURNING id`,
      [
        organizationId, general, number, `DEMO${month}-34${month}`, `C801DEMO${month}`,
        isoDay(issued), isoDay(from), isoDay(to), isoDay(due), POWER_KVA,
        subtotal, vat, total, Math.round(subtotal * 0.38),
      ],
    );
    const invoiceId = inserted.rows[0]!.id;

    for (const period of ['ponta', 'cheias', 'vazio_normal', 'super_vazio'] as const) {
      const register = period === 'vazio_normal' ? 'vazio' : period;
      const previous = opening[period];
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

  if (gas !== null && gasAt !== null) {
    await gasBills(client, organizationId, gas, months, gasAt, billed, counts);

    // -----------------------------------------------------------------------
    // A rate on each of the tank's meters from before the first reading, so
    // every month of its cost report is priced. One live rate per meter is
    // the schema's rule; a meter that already has one keeps it.
    // -----------------------------------------------------------------------
    const owner = await client.query<{ id: string }>(
      `SELECT m.id FROM membership m
         JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
        WHERE m.organization_id = $1 AND m.archived_at IS NULL
        LIMIT 1`,
      [organizationId],
    );
    const ownerId = owner.rows[0]?.id;
    if (ownerId !== undefined) {
      const from = isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 1)));
      // The gas rate is the one on its own bills: contracted. The heat pump has
      // no bill, so its rate is an estimate from the general supply's.
      counts.tariffs += await tariff(client, organizationId, heating, HEAT_PUMP_RATE, 0.16, 0.2, 'estimated', from, ownerId);
      counts.tariffs += await tariff(client, organizationId, gas, GAS_PRICE, null, null, 'contracted', from, ownerId);
    }
  }

  return counts;
}

/** A meter's rate, unless it already has a live one. Answers 1 when it wrote. */
async function tariff(
  client: pg.Client,
  organizationId: string,
  meterId: string,
  price: number,
  low: number | null,
  high: number | null,
  provenance: 'estimated' | 'contracted',
  from: string,
  createdBy: string,
): Promise<number> {
  const live = await client.query(
    `SELECT 1 FROM energy_tariff WHERE organization_id = $1 AND meter_id = $2 AND archived_at IS NULL`,
    [organizationId, meterId],
  );
  if (live.rowCount) return 0;
  await client.query(
    `INSERT INTO energy_tariff
       (organization_id, meter_id, unit_price, unit_price_low, unit_price_high, provenance,
        effective_from, created_by_membership_id)
     VALUES ($1, $2, $3, $4, $5, $6::money_provenance, $7, $8)`,
    [organizationId, meterId, price, low, high, provenance, from, createdBy],
  );
  return 1;
}

/**
 * Twelve gas bills on the boiler's supply, one per completed month — POOLSE-102.
 * A simple tariff: one energy line at the contracted price, the fixed term per
 * day and the IEC, and one `total` register. Matched on the bill's number.
 */
async function gasBills(
  client: pg.Client,
  organizationId: string,
  meterId: string,
  months: { at: Date }[],
  dialAt: Map<string, number>,
  billed: (meterId: string, from: Date) => Promise<boolean>,
  counts: EnergyCounts,
): Promise<void> {
  for (let i = 0; i < months.length - 1; i += 1) {
    const from = months[i]!.at;
    const to = new Date(months[i + 1]!.at.getTime() - 24 * 3600 * 1000);
    // The bill's register is the dial: what it reads at each end of the period.
    const previous = dialAt.get(from.toISOString());
    const register = dialAt.get(months[i + 1]!.at.toISOString());
    if (previous === undefined || register === undefined) continue;
    const kwh = register - previous;
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000)) + 1;
    const issued = new Date(to.getTime() + 6 * 24 * 3600 * 1000);
    const due = new Date(issued.getTime() + 20 * 24 * 3600 * 1000);
    const number = `GN ${from.getUTCFullYear()}/${String(from.getUTCMonth() + 1).padStart(2, '0')}-4831`;

    if (await billed(meterId, from)) continue;

    const energy = Math.round(kwh * GAS_PRICE * 100);
    const fixed = Math.round(days * GAS_FIXED_PER_DAY * 100);
    const iec = Math.round(kwh * GAS_IEC * 100);
    const lines = [
      { kind: 'energy', description: 'Gás natural', period: 'simples', quantity: kwh, unit: 'kWh', unitPrice: GAS_PRICE, cents: energy },
      { kind: 'other', description: 'Termo fixo', period: null, quantity: days, unit: 'dias', unitPrice: GAS_FIXED_PER_DAY, cents: fixed },
      { kind: 'tax', description: 'IEC', period: null, quantity: kwh, unit: 'kWh', unitPrice: GAS_IEC, cents: iec },
    ];
    const subtotal = energy + fixed + iec;
    const vat = Math.round(subtotal * 0.23);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO energy_invoice
         (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end, due_on,
          tariff, reading_quality, subtotal_cents, vat_cents, total_cents, other_charges_cents,
          document_total_cents, source)
       VALUES ($1, $2, 'Galp', $3, $4, $5, $6, $7, 'Gás natural — escalão 4', 'real',
               $8, $9, $10, 0, $10, 'manual')
       RETURNING id`,
      [organizationId, meterId, number, isoDay(issued), isoDay(from), isoDay(to), isoDay(due), subtotal, vat, subtotal + vat],
    );
    const invoiceId = inserted.rows[0]!.id;
    await client.query(
      `INSERT INTO energy_invoice_register (organization_id, invoice_id, register, previous_index, current_index, kwh)
       VALUES ($1, $2, 'total'::energy_register, $3, $4, $5)`,
      [organizationId, invoiceId, previous, register, kwh],
    );
    for (const [position, l] of lines.entries()) {
      await client.query(
        `INSERT INTO energy_invoice_line
           (organization_id, invoice_id, position, kind, description, period, from_on, to_on,
            quantity, unit, unit_price, amount_cents, discount_cents, total_cents, vat_rate)
         VALUES ($1, $2, $3, $4::energy_line_kind, $5, $6::energy_tariff_period, $7, $8, $9, $10, $11, $12, 0, $12, 23)`,
        [
          organizationId, invoiceId, position, l.kind, l.description, l.period,
          l.kind === 'tax' ? null : isoDay(from), l.kind === 'tax' ? null : isoDay(to),
          l.quantity, l.unit, l.unitPrice, l.cents,
        ],
      );
    }
    counts.invoices += 1;
  }
}
