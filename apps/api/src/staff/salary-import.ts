import { withOrg, type Tx } from '@poolse/db';
import {
  isMoneyProvenance,
  isValidNif,
  type CompensationKind,
  type MoneyProvenance,
} from '@poolse/rules';
import { parseImportDate } from '../students/import.js';
import {
  applyNewRate,
  contract,
  day,
  hours,
  HOLDS_A_STAFF_ROLE,
  IS_THE_OWNER,
  LIVE_RATE,
  visibleToViewer,
  RateOverlapError,
  type RateRow,
  type Viewer,
} from './compensation.repository.js';
import { personName } from '../people/names.js';

/**
 * The salaries importer and exporter — POOLSE-59.
 *
 * **One pipeline, two ways in.** Preview and commit are this one function with a
 * flag, exactly as the register's, the inventory's and the partnerships' are:
 * two paths would be two places a row becomes a rate, and applying them
 * differently is how an approved preview turns into a different set of writes.
 *
 * **A person is matched by email or by checksum-valid NIF, never by name.**
 * Those are the two keys unique per tenant in this schema. Two people called Ana
 * Silva is not an edge case in a club with forty staff, and matching them by
 * name would put one of them on the other's salary.
 *
 * **A payroll file commits whole or not at all.** Every included row is written
 * inside one transaction, so a file that fails on line 30 leaves nothing behind.
 * The other importers commit what they can and report the rest; a pay run is the
 * one place where half-applied is worse than not applied, because the half that
 * went through is somebody's wage and nothing on screen would say which half.
 *
 * **What the file cannot do**: create a person, archive a rate, or edit one. It
 * adds a new effective-dated rate, through `applyNewRate` — the same function the
 * form calls — which closes the open-ended rate it succeeds and refuses anything
 * else. An unknown person is a rejected row with a reason, never a silent
 * create: a payroll file is the wrong place to learn who works here.
 */

/** Machine keys. The web app owns the sentences, in both languages. */
export type SalaryImportProblem =
  | 'noKey'
  | 'badNif'
  | 'notFound'
  | 'notStaff'
  | 'ownerRefused'
  | 'kindMissing'
  | 'provenanceInvalid'
  | 'amountInvalid'
  | 'hoursInvalid'
  | 'periodsInvalid'
  | 'dateMissing'
  | 'dateInvalid'
  | 'overlap'
  | 'duplicateInFile';

/** One row as the Next server hands it over: mapped, and the amount already in cents. */
export interface SalaryImportInput {
  name?: string | undefined;
  email?: string | undefined;
  taxNumber?: string | undefined;
  kind?: string | undefined;
  /**
   * Cents, parsed on the Next server by `parseCents` — the same function the
   * typed form uses, which is the point. A second parser here would accept a
   * shape the form refuses, and "€1.200,00" is exactly the sort of string two
   * implementations disagree about.
   */
  amountCents?: number | null | undefined;
  /** What the cell actually said, so a refusal can quote it back. */
  amount?: string | undefined;
  weeklyHours?: string | undefined;
  payPeriods?: string | undefined;
  effectiveFrom?: string | undefined;
  /** `docs/financials.md` §2. Absent means contracted — what a typed rate is. */
  provenance?: string | undefined;
  note?: string | undefined;
}

export interface SalaryImportRowResult {
  index: number;
  /** The spreadsheet line, counting the header as 1. */
  line: number;
  name: string;
  email: string | null;
  taxNumber: string | null;
  /** Who the keys matched, and what they are called here rather than in the file. */
  membershipId: string | null;
  matchedName: string | null;
  roles: string[];
  kind: CompensationKind | null;
  amountCents: number | null;
  weeklyHours: number | null;
  payPeriodsPerYear: number;
  effectiveFrom: string | null;
  provenance: MoneyProvenance;
  note: string | null;
  /** What they are on today, so the preview can show old → new. */
  current: {
    kind: CompensationKind;
    amountCents: number;
    weeklyHours: number | null;
    effectiveFrom: string;
  } | null;
  /** The file says what the live rate already says. Nothing to write. */
  unchanged: boolean;
  /** No amount at all — an exported row for somebody with no rate yet. */
  blank: boolean;
  problems: SalaryImportProblem[];
  /** An earlier line of the same file naming the same person. */
  repeatOfLine: number | null;
  importable: boolean;
}

export interface SalaryImportResult {
  rows: SalaryImportRowResult[];
  summary: {
    total: number;
    importable: number;
    unchanged: number;
    blank: number;
    rejected: number;
  };
  /**
   * Set when the whole file is refused rather than individual rows.
   *
   * One person twice in one file is the case: which of the two rows is their pay
   * is not something to guess, and importing both would write a rate and then
   * immediately supersede it.
   */
  refusal: 'duplicatePerson' | null;
  committed: boolean;
  written: number;
}

/** A row that failed at commit time, named by its line. Nothing was written. */
export class SalaryCommitError extends Error {
  constructor(readonly line: number, readonly problem: SalaryImportProblem) {
    super(`Line ${line} could not be written`);
    this.name = 'SalaryCommitError';
  }
}

interface Target {
  membershipId: string;
  name: string;
  email: string | null;
  taxNumber: string | null;
  roles: string[];
  isOwner: boolean;
  staff: boolean;
  visible: boolean;
  live: RateRow | null;
}

/**
 * Every live person the club has, with their keys and today's rate.
 *
 * Loaded whole rather than looked up per row: one query, bounded by the club,
 * where forty rows of a spreadsheet would otherwise be forty round trips.
 *
 * **Everybody, not only staff**, so a file naming a student can say *that person
 * is not staff* rather than *we have no such person*. They are two different
 * things for the operator to do about it, and the second would send somebody
 * hunting for a typo in an address that is perfectly correct.
 *
 * `visible` carries the Owner rule, so an import applies exactly the same
 * boundary as the list — an Admin naming the Owner gets a stated refusal rather
 * than a silent skip.
 */
async function loadTargets(tx: Tx, viewer: Viewer): Promise<Target[]> {
  const { rows } = await tx.query<{
    membership_id: string;
    name: string | null;
    email: string | null;
    tax_number: string | null;
    roles: string[];
    is_owner: boolean;
    staff: boolean;
    visible: boolean;
    live: RateRow | null;
  }>(
    `SELECT m.id AS membership_id,
            ${personName('m.id')} AS name,
            person_email(m.id)::text AS email,
            m.tax_number,
            coalesce((
              SELECT array_agg(r.role::text ORDER BY r.role::text)
                FROM membership_role r
               WHERE r.membership_id = m.id
                 AND r.organization_id = m.organization_id
                 AND r.archived_at IS NULL
            ), '{}'::text[]) AS roles,
            ${IS_THE_OWNER} AS is_owner,
            ${HOLDS_A_STAFF_ROLE} AS staff,
            ${visibleToViewer('$1')} AS visible,
            ${LIVE_RATE} AS live
       FROM membership m
      WHERE m.archived_at IS NULL`,
    [viewer.isOwner],
  );

  return rows.map((row) => ({
    membershipId: row.membership_id,
    name: row.name ?? '',
    email: row.email === null ? null : row.email.trim().toLowerCase(),
    taxNumber: row.tax_number,
    roles: row.roles,
    isOwner: row.is_owner,
    staff: row.staff,
    visible: row.visible,
    live: row.live,
  }));
}

/*
 * There is deliberately no "is this date in the past" check.
 *
 * Backdating a raise to when it was agreed is ordinary — a club settles the
 * September rise in October every year — and a future date is how next season is
 * prepared. Both are accepted, and the preview shows the resolved date beside
 * every row so the operator sees what the column was read as.
 */

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The type column, in either language and in the enum's own spelling.
 *
 * An export writes `monthly` / `hourly` — the enum words — because a file
 * exported under `en` is re-imported under `pt-PT` and a translated value would
 * not survive the journey. A club typing "Mensal" by hand still works, which is
 * what the rest of this list is for.
 */
function readKind(raw: string): CompensationKind | null {
  const value = raw.toLowerCase();
  if (value === '') return null;
  if (['monthly', 'mensal', 'mês', 'mes', 'salário', 'salario', 'month'].includes(value)) {
    return 'monthly';
  }
  if (['hourly', 'hora', 'à hora', 'a hora', 'por hora', 'hour', 'per hour'].includes(value)) {
    return 'hourly';
  }
  return null;
}

/** A decimal written either way. `12,5` and `12.5` are the same number of hours. */
/**
 * The provenance column, in either language and in the enum's own spelling.
 *
 * An export writes the enum word so a file exported under `en` re-imports under
 * `pt-PT`; a club typing "estimativa" by hand still works, which is what the
 * rest of this list is for.
 */
function readProvenance(raw: string): MoneyProvenance | null {
  const value = raw.toLowerCase();
  if (value === '') return null;
  if (isMoneyProvenance(value)) return value;

  const words: Record<string, MoneyProvenance> = {
    real: 'actual',
    efetivo: 'actual',
    contratado: 'contracted',
    contrato: 'contracted',
    estimado: 'estimated',
    estimativa: 'estimated',
    assumido: 'assumed',
    suposto: 'assumed',
    palpite: 'assumed',
    guess: 'assumed',
    estimate: 'estimated',
  };
  return words[value] ?? null;
}

function readNumber(raw: string): number | null {
  if (raw === '') return null;
  const parsed = Number.parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function runSalaryImport(
  organizationId: string,
  viewer: Viewer,
  request: { rows: SalaryImportInput[]; commit: boolean; include: number[] | null },
): Promise<SalaryImportResult> {
  return withOrg(organizationId, async (tx) => {
    const targets = await loadTargets(tx, viewer);

    const byEmail = new Map<string, Target>();
    const byNif = new Map<string, Target>();
    for (const target of targets) {
      if (target.email !== null) byEmail.set(target.email, target);
      if (target.taxNumber !== null) byNif.set(target.taxNumber, target);
    }

    /** Which line first named each person, so a repeat can point back at it. */
    const firstLine = new Map<string, number>();
    const results: SalaryImportRowResult[] = [];

    request.rows.forEach((raw, index) => {
      const line = index + 2;
      const problems: SalaryImportProblem[] = [];

      const email = text(raw.email).toLowerCase();
      const taxNumber = text(raw.taxNumber).replace(/\s/g, '');
      const name = text(raw.name);

      // --- who ---------------------------------------------------------
      let target: Target | null = null;
      if (email === '' && taxNumber === '') {
        problems.push('noKey');
      } else {
        if (taxNumber !== '' && !isValidNif(taxNumber)) problems.push('badNif');

        target =
          (email === '' ? undefined : byEmail.get(email)) ??
          (taxNumber === '' || !isValidNif(taxNumber) ? undefined : byNif.get(taxNumber)) ??
          null;

        if (target === null) problems.push('notFound');
        else if (!target.staff) problems.push('notStaff');
        else if (!target.visible) problems.push('ownerRefused');
      }

      // --- what ---------------------------------------------------------
      const amountCents =
        typeof raw.amountCents === 'number' && Number.isInteger(raw.amountCents)
          ? raw.amountCents
          : null;
      const amountText = text(raw.amount);
      const blank = amountCents === null && amountText === '';

      if (!blank && (amountCents === null || amountCents <= 0)) problems.push('amountInvalid');

      const kind = readKind(text(raw.kind));
      if (!blank && kind === null) problems.push('kindMissing');

      const rawHours = text(raw.weeklyHours);
      const weeklyHours = readNumber(rawHours);
      if (rawHours !== '' && (weeklyHours === null || weeklyHours <= 0 || weeklyHours > 80)) {
        problems.push('hoursInvalid');
      }

      /*
      * Where the figure came from. An unreadable word is a rejected row rather
      * than a silent `contracted`: importing somebody's estimate as a contract
      * is precisely the mislabelling the financial rules exist to prevent.
      */
      const rawProvenance = text(raw.provenance);
      const provenance = readProvenance(rawProvenance);
      if (rawProvenance !== '' && provenance === null) problems.push('provenanceInvalid');

      const rawPeriods = text(raw.payPeriods);
      const periods = rawPeriods === '' ? 14 : readNumber(rawPeriods);
      if (periods !== 12 && periods !== 14) problems.push('periodsInvalid');

      /*
       * Day first, from `parseImportDate` — the reader all four other importers
       * use, which takes ISO, `03/04/2026`, an ISO timestamp and an Excel serial.
       * A missing date and an unreadable one are two different problems: one is a
       * column the operator forgot to fill in, the other is a column read wrongly.
       */
      const rawDate = text(raw.effectiveFrom);
      const parsedDate = parseImportDate(rawDate);
      const effectiveFrom = 'date' in parsedDate && parsedDate.date !== '' ? parsedDate.date : null;
      if (!blank && effectiveFrom === null) {
        problems.push(rawDate === '' ? 'dateMissing' : 'dateInvalid');
      }

      // --- against what is there today -----------------------------------
      const live = target?.live ?? null;
      const current =
        live === null
          ? null
          : {
              kind: live.kind,
              amountCents: live.amount_cents,
              weeklyHours: hours(live.weekly_hours),
              effectiveFrom: day(live.effective_from),
            };

      /*
       * The round-trip case, and the reason it is a state of its own.
       *
       * An exported file re-imported unchanged must preview as nothing to do and
       * commit nothing at all. "Unchanged" is every field of the contract
       * agreeing with the live rate — including the date it started, because a
       * row that says the same money from a different day is a real change.
       */
      const unchanged =
        live !== null &&
        current !== null &&
        !blank &&
        (provenance ?? 'contracted') === live.provenance &&
        kind === current.kind &&
        amountCents === current.amountCents &&
        (weeklyHours ?? null) === current.weeklyHours &&
        effectiveFrom === current.effectiveFrom &&
        periods === live.pay_periods_per_year;

      /*
       * An overlap the file can be told about now rather than at commit.
       *
       * The same rule `applyNewRate` enforces: a rate may follow an open-ended
       * one, and may not land inside a period somebody closed by hand or before
       * a rate that already exists. Checked here so the preview is honest, and
       * enforced there regardless — this is a prediction, not the guard.
       */
      if (target !== null && !blank && !unchanged && effectiveFrom !== null && live !== null) {
        const closesOn = live.effective_to === null ? null : day(live.effective_to);
        const collides =
          closesOn === null
            ? // Open-ended: a new rate must start strictly after it, and closing
              // it the day before is what `applyNewRate` will do.
              effectiveFrom <= day(live.effective_from)
            : // Closed by hand: landing anywhere inside it contradicts a date a
              // person chose, and is refused rather than rewritten.
              effectiveFrom <= closesOn;
        if (collides) problems.push('overlap');
      }

      // --- twice in one file ---------------------------------------------
      let repeatOfLine: number | null = null;
      if (target !== null) {
        const seen = firstLine.get(target.membershipId);
        if (seen === undefined) firstLine.set(target.membershipId, line);
        else {
          repeatOfLine = seen;
          problems.push('duplicateInFile');
        }
      }

      const importable =
        problems.length === 0 && !blank && !unchanged && target !== null && effectiveFrom !== null;

      results.push({
        index,
        line,
        name,
        email: email === '' ? null : email,
        taxNumber: taxNumber === '' ? null : taxNumber,
        membershipId: target?.membershipId ?? null,
        matchedName: target?.name ?? null,
        roles: target?.roles ?? [],
        kind,
        amountCents,
        weeklyHours,
        payPeriodsPerYear: periods === 12 ? 12 : 14,
        effectiveFrom,
        provenance: provenance ?? 'contracted',
        note: text(raw.note) === '' ? null : text(raw.note),
        current,
        unchanged,
        blank,
        problems,
        repeatOfLine,
        importable,
      });
    });

    const refusal = results.some((row) => row.problems.includes('duplicateInFile'))
      ? ('duplicatePerson' as const)
      : null;

    const summary = {
      total: results.length,
      importable: results.filter((row) => row.importable).length,
      unchanged: results.filter((row) => row.unchanged).length,
      blank: results.filter((row) => row.blank).length,
      rejected: results.filter((row) => row.problems.length > 0).length,
    };

    if (!request.commit || refusal !== null) {
      return { rows: results, summary, refusal, committed: false, written: 0 };
    }

    /*
     * The commit: every included row, in one transaction.
     *
     * `include === null` means "everything the preview would have ticked", which
     * is the same default the wizard seeds and the same one the other importers
     * take — the three agree on purpose, so an operator who ticks nothing gets
     * what they saw.
     */
    const chosen = new Set(request.include ?? results.filter((r) => r.importable).map((r) => r.index));

    let written = 0;
    for (const row of results) {
      if (!row.importable || !chosen.has(row.index)) continue;

      try {
        await applyNewRate(tx, row.membershipId!, {
          kind: row.kind!,
          amountCents: row.amountCents!,
          weeklyHours: row.weeklyHours,
          payPeriodsPerYear: row.payPeriodsPerYear,
          effectiveFrom: row.effectiveFrom!,
          note: row.note,
          provenance: row.provenance,
          // The sheet carries no range — see `SALARY_EXPORT_FIELDS`. An imported
          // figure therefore has none, which is the honest answer for a row that
          // arrived as a single number.
          amountLowCents: null,
          amountHighCents: null,
        });
        written += 1;
      } catch (error) {
        // Whole or nothing. The throw rolls the transaction back and the
        // controller turns it into a 409 naming the line, so the operator knows
        // which row to fix rather than which half of the club was paid.
        if (error instanceof RateOverlapError) {
          throw new SalaryCommitError(row.line, 'overlap');
        }
        throw error;
      }
    }

    return { rows: results, summary, refusal, committed: true, written };
  });
}

/** One row of the exported pay list. Every value a string, as the file holds it. */
export interface SalaryExportRow {
  name: string;
  email: string;
  taxNumber: string;
  kind: string;
  amount: string;
  weeklyHours: string;
  payPeriods: string;
  effectiveFrom: string;
  provenance: string;
  note: string;
}

/**
 * The pay list, for a file.
 *
 * **Everybody the viewer may see, including people with no rate**, whose row
 * carries a name, their keys and nothing else. That makes the export a usable
 * template — fill in the empty line and import it back — and the importer reads
 * a row with no amount as nothing to do rather than as an error.
 *
 * The type is written as the enum's own spelling and the date as ISO, because a
 * file exported under `en` is re-imported under `pt-PT`. The amount is a plain
 * decimal with no symbol and no thousands separator: our own reader takes it
 * either way, and this is the shape every other system also takes.
 */
export async function exportSalaries(
  organizationId: string,
  viewer: Viewer,
): Promise<SalaryExportRow[]> {
  return withOrg(organizationId, async (tx) => {
    const targets = await loadTargets(tx, viewer);

    return targets
      .filter((target) => target.visible)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
      .map((target) => {
        const live = target.live;
        if (live === null) {
          return {
            name: target.name,
            email: target.email ?? '',
            taxNumber: target.taxNumber ?? '',
            kind: '',
            amount: '',
            weeklyHours: '',
            payPeriods: '',
            effectiveFrom: '',
            provenance: '',
            note: '',
          };
        }

        const c = contract(live);
        return {
          name: target.name,
          email: target.email ?? '',
          taxNumber: target.taxNumber ?? '',
          kind: live.kind,
          amount: (live.amount_cents / 100).toFixed(2),
          weeklyHours: c.weeklyHours === null ? '' : String(c.weeklyHours),
          payPeriods: String(live.pay_periods_per_year),
          effectiveFrom: day(live.effective_from),
          provenance: live.provenance,
          note: live.note ?? '',
        };
      });
  });
}
