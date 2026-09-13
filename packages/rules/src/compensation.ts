/**
 * Staff pay — the two derivations and the roll-up arithmetic — POOLSE-58.
 *
 * **Display-only, and computed in exactly one place.** A monthly salary implies
 * an hourly rate and an hourly rate implies a monthly cost, but neither is ever
 * stored: a stored figure is a second definition that drifts from the first the
 * day somebody changes their contracted hours. Same reasoning as the absent
 * `is_overdue` column and the absent `next_due_at`.
 *
 * **Here rather than in the API** because the same numbers appear on a row, on
 * the roll-up card and (POOLSE-59) in an exported spreadsheet, and because the
 * web app must be able to render a preview of a rate somebody is typing without
 * a round trip. The API is what actually computes the figures it ships — the
 * client renders them — but both halves calling one function is what makes that
 * a convention rather than a hope.
 *
 * **Pure**, like everything else in this package: no database, no clock, no
 * locale. Money in and money out, in integer cents.
 */

/** How the amount on a contract is expressed. Mirrors the `compensation_kind` enum. */
export type CompensationKind = 'monthly' | 'hourly';

/**
 * Where a monetary figure came from — `docs/financials.md` §2.
 *
 * Here rather than in the API because both apps have to be able to *say* it: the
 * screen mutes a guess, and the roll-up labels a total with the weakest thing it
 * summed. Mirrors the `money_provenance` enum, and is deliberately the shared
 * list rather than a salary-specific one — an energy bill and a wage answer this
 * question the same way.
 */
export type MoneyProvenance = 'actual' | 'contracted' | 'estimated' | 'assumed';

/**
 * Weakest last. The order *is* the rule: a total that mixes provenances is
 * labelled with the weakest component it summed, and "weakest" is defined here
 * so no screen has to decide for itself.
 *
 * `actual` happened, `contracted` is a known rate not yet incurred, `estimated`
 * comes from a documented model, `assumed` is a guess.
 */
export const PROVENANCE_STRENGTH: readonly MoneyProvenance[] = [
  'actual',
  'contracted',
  'estimated',
  'assumed',
];

export function isMoneyProvenance(value: string): value is MoneyProvenance {
  return (PROVENANCE_STRENGTH as readonly string[]).includes(value);
}

/** The weakest of a set, or `actual` for an empty one — nothing summed, nothing doubted. */
export function weakestProvenance(
  entries: readonly MoneyProvenance[],
): MoneyProvenance {
  let weakest: MoneyProvenance = 'actual';
  for (const entry of entries) {
    if (PROVENANCE_STRENGTH.indexOf(entry) > PROVENANCE_STRENGTH.indexOf(weakest)) {
      weakest = entry;
    }
  }
  return weakest;
}

/**
 * The Portuguese year is 14 pay periods — twelve months, subsídio de férias,
 * subsídio de Natal. A club paying duodécimos uses 12. Nothing else is accepted,
 * by CHECK, because every figure below is wrong for any other value.
 */
export const PAY_PERIODS = [12, 14] as const;
export const DEFAULT_PAY_PERIODS = 14;

export function isPayPeriods(value: number): boolean {
  return (PAY_PERIODS as readonly number[]).includes(value);
}

/**
 * Weeks in a year, spread over twelve months.
 *
 * 52 rather than 52.1775, deliberately: it is the figure a club uses when it
 * writes a contract, and a total that disagrees with the operator's own
 * arithmetic by a euro is a total they stop trusting. The estimate is labelled
 * as an estimate everywhere it appears, which is the honest way to carry a
 * rounding convention.
 */
const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;

/** One contract, as the database holds it. */
export interface Compensation {
  kind: CompensationKind;
  amountCents: number;
  /** Contracted hours per week. Null means not measured — never zero. */
  weeklyHours: number | null;
  payPeriodsPerYear: number;
  /**
   * Where the figure came from. Defaults to `contracted` for a caller that has
   * not been taught about it yet — which is what a typed wage is.
   */
  provenance?: MoneyProvenance;
}

/**
 * Hours worked in an average month, from the contracted week.
 *
 * Null when the hours are not known, which is the whole reason every function
 * below returns null rather than a number: an unknown divisor produces a
 * confident wrong answer, and on this screen that answer is somebody's wage.
 */
function monthlyHours(weeklyHours: number | null): number | null {
  if (weeklyHours === null || weeklyHours <= 0) return null;
  return (weeklyHours * WEEKS_PER_YEAR) / MONTHS_PER_YEAR;
}

/**
 * What this person costs in an average month, subsídios spread.
 *
 * For a monthly contract: `amount × periods ÷ 12` — a 14-period contract at
 * €1,000 costs €1,166.67 a month, not €1,000. For an hourly contract: the
 * contracted hours at the rate. Null when an hourly contract has no hours.
 */
export function annualisedMonthlyCents(c: Compensation): number | null {
  if (c.kind === 'monthly') {
    return round(c.amountCents * (c.payPeriodsPerYear / MONTHS_PER_YEAR));
  }
  const hours = monthlyHours(c.weeklyHours);
  if (hours === null) return null;
  return round(c.amountCents * hours);
}

/**
 * What is actually paid in an ordinary month.
 *
 * The contracted amount for a monthly contract — €1,000 is €1,000, whatever the
 * subsídios do in June and November — and the same hours-at-the-rate figure for
 * an hourly one. This and the figure above are the roll-up's two columns, and
 * they are different questions: the bank account asks the first, a budget asks
 * the second.
 */
export function thisMonthCents(c: Compensation): number | null {
  if (c.kind === 'monthly') return c.amountCents;
  const hours = monthlyHours(c.weeklyHours);
  if (hours === null) return null;
  return round(c.amountCents * hours);
}

/**
 * The hourly rate implied by a contract.
 *
 * The annualised monthly cost over the monthly hours, so a 14-period salary
 * yields a higher hourly rate than a 12-period one at the same amount — which is
 * true, and is the point of showing it. Null without hours; an hourly contract
 * returns what it says.
 */
export function hourlyCents(c: Compensation): number | null {
  if (c.kind === 'hourly') return c.amountCents;
  const hours = monthlyHours(c.weeklyHours);
  if (hours === null) return null;
  const monthly = annualisedMonthlyCents(c);
  if (monthly === null) return null;
  return round(monthly / hours);
}

/**
 * The monthly figure a contract states in its own terms, for the row.
 *
 * A monthly contract states its amount; an hourly one does not state a monthly
 * figure at all, so this derives one — and `derived` says which happened, so the
 * screen can mute it and mark it an estimate without re-deciding.
 */
export interface Derived {
  cents: number | null;
  derived: boolean;
}

export function monthlyForRow(c: Compensation): Derived {
  return {
    cents: thisMonthCents(c),
    derived: c.kind === 'hourly',
  };
}

export function hourlyForRow(c: Compensation): Derived {
  return {
    cents: hourlyCents(c),
    derived: c.kind === 'monthly',
  };
}

/** What the roll-up card says. Every figure in cents; counts are people. */
export interface Rollup {
  /** What leaves the bank in an ordinary month. */
  thisMonthCents: number;
  /** What employing these people costs per month once subsídios are spread. */
  annualisedMonthlyCents: number;
  /** The two halves of the first figure, so the split is not re-derived. */
  monthlyContractCents: number;
  hourlyContractCents: number;
  monthlyContractCount: number;
  hourlyContractCount: number;
  /** People with a live rate whose hours are not recorded — see below. */
  hoursUnknownCount: number;
  /** Staff with no live rate at all. */
  noRateCount: number;

  /**
   * How much of the club this total is about — `docs/financials.md` §6.
   *
   * "Based on 11 of 14 staff", said out loud. An unqualified figure over partial
   * data is worse than showing nothing: it is the same shape as a complete
   * answer and nothing on it says which.
   */
  coverage: { withRate: number; total: number };
  /** True only when every staff member has a live rate. */
  complete: boolean;

  /**
   * The weakest provenance this total summed — §2.
   *
   * Never one unlabelled figure across provenances. The breakdown travels with
   * it so a screen can show either the label or the split.
   */
  provenance: MoneyProvenance;
  byProvenance: Record<MoneyProvenance, number>;
}

/**
 * The card, from every live rate in the club.
 *
 * **A contract whose hours are unknown contributes nothing and is counted
 * separately.** Folding it in at zero would make the total read as though that
 * person were free, and an owner acts on this number. `hoursUnknownCount` is
 * what the card says instead, in words.
 *
 * `noRate` is passed in rather than inferred, because "staff with nothing
 * recorded" is a fact about the staff list — which is scoped by who is looking —
 * and not about the rows here. An Admin's card counts one fewer person than the
 * Owner's, and that is stated on the card rather than hidden in this sum.
 */
export function rollup(live: readonly Compensation[], noRateCount: number): Rollup {
  const out: Rollup = {
    thisMonthCents: 0,
    annualisedMonthlyCents: 0,
    monthlyContractCents: 0,
    hourlyContractCents: 0,
    monthlyContractCount: 0,
    hourlyContractCount: 0,
    hoursUnknownCount: 0,
    noRateCount,
    coverage: { withRate: live.length, total: live.length + noRateCount },
    complete: noRateCount === 0,
    provenance: weakestProvenance(live.map((c) => c.provenance ?? 'contracted')),
    byProvenance: { actual: 0, contracted: 0, estimated: 0, assumed: 0 },
  };

  for (const c of live) {
    const now = thisMonthCents(c);
    const year = annualisedMonthlyCents(c);

    if (c.kind === 'monthly') out.monthlyContractCount += 1;
    else out.hourlyContractCount += 1;

    if (now === null || year === null) {
      out.hoursUnknownCount += 1;
      continue;
    }

    /*
     * Split by where the figure came from, as well as added up.
     *
     * §2 forbids one unlabelled total across provenances; this is the half that
     * makes obeying it possible without every screen re-deriving the split.
     */
    out.byProvenance[c.provenance ?? 'contracted'] += now;

    out.thisMonthCents += now;
    out.annualisedMonthlyCents += year;
    if (c.kind === 'monthly') out.monthlyContractCents += now;
    else out.hourlyContractCents += now;
  }

  return out;
}

/**
 * Half-up to the nearest cent, at the last step only.
 *
 * `Math.round` is half-up for positives and these are all positive by CHECK.
 * Rounding intermediate values instead would put a few cents on a twenty-person
 * roll-up and make the card disagree with the rows it sums.
 */
function round(cents: number): number {
  return Math.round(cents);
}
