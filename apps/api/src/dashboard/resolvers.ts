import { energyCosts } from '../energy/invoices.repository.js';
import { listMyTasks } from '../maintenance/maintenance.repository.js';
import { SITE_PAGE_ROLES } from '../facilities/site-access.js';
import { readSetupProgress } from './dashboard.repository.js';
import { excursions, resolveBands, type PoolMetric } from '@poolse/rules';
import { salarySummary, type SalarySummary } from '../staff/compensation.repository.js';
import {
  readQualificationsWidget,
  type QualificationsWidget,
} from '../staff/qualifications.repository.js';
import {
  readMaintenanceOpen,
  readMoneyPeriod,
  readOccupancyToday,
  readPeopleSummary,
  readPoolWater,
  type MaintenanceOpen,
  type MoneyPeriod,
  type OccupancyToday,
  type PeopleSummary,
} from './management.repository.js';
import {
  readMyTurmas,
  readMyWeek,
  readNextClass,
  type MyTurma,
  type NextClass,
  type WeekClass,
} from './instructor.repository.js';
import { readLessonPlan } from '../classes/lesson-plans.repository.js';
import { studentFees } from '../billing/fees.repository.js';
import type { FeeBalance } from '../billing/fee-balance.js';
import {
  readChildAttendance,
  readChildNextClass,
  readPoolTemperature,
  type ChildAttendance,
  type ChildNextClass,
  type PoolTemperature,
} from './family.repository.js';
import {
  readInventoryWatch,
  readOpenFaults,
  readOverdueSpaces,
  type InventoryWatch,
  type OpenFaults,
  type OverdueSpaces,
} from './maintenance-band.repository.js';
import type { ResolverContext } from './widget-registry.js';
import { readFreeSwim, type FreeSwim } from '../reception/passes.repository.js';
import { readLeadsWidget, type LeadsWidget } from '../leads/leads.repository.js';

/**
 * The three resolvers slice 1 ships — POOLSE-66.
 *
 * All three answer from data that already exists, through the repository
 * functions the existing endpoints use. That is deliberate: a slice that ends in
 * stubs has not ended, and a resolver that duplicates a query is a second
 * definition of a figure the product already states somewhere else.
 *
 * **A resolver answers `null` for "there is nothing here", and throws for "that
 * went wrong".** The composer turns the first into `state: 'empty'` and the
 * second into `state: 'error'`, and the difference is the whole point: a club
 * with no tasks outstanding and a broken query must not look the same.
 */

export interface TasksWidget {
  total: number;
  /** The first few, for the card. The link goes to the real list. */
  tasks: unknown[];
  /**
   * Whether the reader may open the site page, where the real list is. An
   * instructor with a task may not (15-10-2026), so the card opens the task.
   */
  canOpenSite: boolean;
}

/** How many tasks a card shows before it stops being a card. */
const TASKS_SHOWN = 5;

/**
 * What is mine — slice 4.3's panel, resolving through the same repository
 * function `/maintenance/tasks/mine` uses, including its rule that a job nobody
 * has been given is still visible to somebody.
 */
export async function myTasks(ctx: ResolverContext): Promise<TasksWidget | null> {
  const tasks = await listMyTasks(ctx.organizationId, ctx.membershipId, true);
  if (tasks.length === 0) return null;

  return {
    total: tasks.length,
    tasks: tasks.slice(0, TASKS_SHOWN),
    canOpenSite: SITE_PAGE_ROLES.some((role) => ctx.roles.includes(role)),
  };
}

export interface EnergyCostsWidget {
  /** Twelve months of bills, summed here rather than in the card. */
  totalCents: number;
  kwh: number;
  billCount: number;
  /** Every month present, an unbilled one null — the chart draws a gap. */
  months: { month: string; totalCents: number | null; kwh: number | null }[];
  latest: {
    supplier: string;
    meterName: string;
    periodStart: string;
    periodEnd: string;
    totalCents: number;
    kwh: number;
  } | null;
}

/**
 * What the club's electricity has cost — slice 2a.
 *
 * The one widget in this slice that was not in slice 1: it was a bespoke panel
 * on the dashboard outside the registry, which is exactly the drift the registry
 * exists to end. Same repository function `/energy/costs` answers from, so the
 * card and the Energia screen cannot disagree about a euro.
 *
 * **The totals are summed here, not in the card.** The panel this replaces
 * reduced the months in the component; a figure derived in two places is a
 * figure that disagrees in one of them, and the rule is that a derived answer is
 * derived once, on the server.
 *
 * `null` when the club has no bills at all, which is the panel's own behaviour —
 * but as an `empty` card rather than as nothing, so a club with meters and no
 * bill yet is told where bills go instead of being shown a blank page.
 */
export async function energySpend(ctx: ResolverContext): Promise<EnergyCostsWidget | null> {
  const costs = await energyCosts(ctx.organizationId);
  if (costs.billCount === 0) return null;

  return {
    totalCents: costs.months.reduce((sum, m) => sum + (m.totalCents ?? 0), 0),
    kwh: costs.months.reduce((sum, m) => sum + (m.kwh ?? 0), 0),
    billCount: costs.billCount,
    months: costs.months.map((m) => ({ month: m.month, totalCents: m.totalCents, kwh: m.kwh })),
    latest:
      costs.latest === null
        ? null
        : {
            supplier: costs.latest.supplier,
            meterName: costs.latest.meterName,
            periodStart: costs.latest.periodStart,
            periodEnd: costs.latest.periodEnd,
            totalCents: costs.latest.totalCents,
            kwh: costs.latest.kwh,
          },
  };
}

export interface ChecklistStep {
  id: 'facility' | 'pools' | 'prices' | 'staff' | 'students';
  done: boolean;
}

export interface ChecklistWidget {
  steps: ChecklistStep[];
}

/**
 * What a brand-new club does next.
 *
 * Rendered **only** when the club has no sites, and then it is the only thing on
 * the page — see `compose.ts`. The later steps are computed anyway rather than
 * assumed false: a club that archived its last site has students and a price
 * list, and telling it to start from nothing would be wrong as well as
 * dispiriting.
 *
 * Never `null`: an empty club is exactly when this has something to say.
 */
export async function setupChecklist(ctx: ResolverContext): Promise<ChecklistWidget> {
  const progress = await readSetupProgress(ctx.organizationId);

  return {
    steps: [
      { id: 'facility', done: progress.facilities > 0 },
      { id: 'pools', done: progress.pools > 0 },
      { id: 'prices', done: progress.feePlans > 0 },
      { id: 'staff', done: progress.staff > 0 },
      { id: 'students', done: progress.students > 0 },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* The management band's aggregates — slice 2b                                */
/* -------------------------------------------------------------------------- */

/**
 * Mensalidades in their current period. Empty when no line is current — a club
 * that has not priced anything yet has nothing to sum, and "0,00 €" would read
 * as a month nobody paid.
 */
export async function moneyPeriod(ctx: ResolverContext): Promise<MoneyPeriod | null> {
  const money = await readMoneyPeriod(ctx.organizationId, ctx.facilityIds);
  return money.lines === 0 ? null : money;
}

/** Today's classes. Empty on a day nothing is scheduled — a Sunday, a closure. */
export async function occupancyToday(ctx: ResolverContext): Promise<OccupancyToday | null> {
  const today = await readOccupancyToday(ctx.organizationId, ctx.facilityIds);
  return today.classes === 0 ? null : today;
}

/**
 * Free swim — POOLSE-68: the tanks now and this month's sales, which are
 * never added to the mensalidades card. Empty for a club that sells no free
 * swim at these sites — the card would otherwise say "0 na água" about a
 * service that does not exist.
 */
export async function freeSwim(ctx: ResolverContext): Promise<FreeSwim | null> {
  const swim = await readFreeSwim(ctx.organizationId, ctx.facilityIds);
  return swim.products === 0 && swim.month.sales === 0 ? null : swim;
}

/** A tank at nine-tenths of its ceiling is the thing reception must see coming. */
export function tankIsNearlyFull(data: unknown): boolean {
  const swim = data as FreeSwim | null;
  if (swim === null) return false;
  return swim.pools.some(
    (pool) => pool.capacity !== null && pool.swimmers + pool.inClasses >= pool.capacity * 0.9,
  );
}

/** Open requests and overdue rooms. Empty is good news: nothing outstanding. */
export async function maintenanceOpen(ctx: ResolverContext): Promise<MaintenanceOpen | null> {
  const open = await readMaintenanceOpen(ctx.organizationId, ctx.facilityIds);
  return open.open.length === 0 && open.overdueCleanings === 0 ? null : open;
}

export function maintenanceNeedsSomebody(data: unknown): boolean {
  const open = data as MaintenanceOpen | null;
  if (open === null) return false;
  return open.overdueCleanings > 0 || open.open.some((group) => group.type === 'fault');
}

export interface WaterQualityWidget {
  /** Live tanks in scope, so "2 of 5" can be said. */
  tanks: number;
  /** Tanks out of range, due, or both — the ones somebody should look at. */
  flagged: {
    poolId: string;
    poolName: string;
    takenAt: string | null;
    outOfRange: PoolMetric[];
    due: boolean;
  }[];
}

/**
 * Tanks whose latest analysis is out of range, or overdue for one.
 *
 * The verdict is `excursions` against `resolveBands` — the one definition the
 * pool page and the alert email share — over the latest live analysis that one
 * SQL statement fetched for every tank at once. Empty when there are no tanks,
 * and when every tank is in range and on time: that is the sentence a club
 * wants to read, and it is not an error.
 */
export async function waterQuality(ctx: ResolverContext): Promise<WaterQualityWidget | null> {
  const pools = await readPoolWater(ctx.organizationId, ctx.facilityIds);
  if (pools.length === 0) return null;

  const flagged = pools.flatMap((pool) => {
    const bad = excursions(pool.values, resolveBands(pool.overrides, pool.pool));
    if (bad.length === 0 && !pool.due) return [];
    return [
      {
        poolId: pool.poolId,
        poolName: pool.poolName,
        takenAt: pool.takenAt,
        outOfRange: bad.map((excursion) => excursion.metric),
        due: pool.due,
      },
    ];
  });

  return flagged.length === 0 ? null : { tanks: pools.length, flagged };
}

export function waterIsOutOfRange(data: unknown): boolean {
  const water = data as WaterQualityWidget | null;
  return water?.flagged.some((pool) => pool.outOfRange.length > 0) ?? false;
}

/** The club's people. Never empty: a club has at least the person reading this. */
export async function people(ctx: ResolverContext): Promise<PeopleSummary> {
  return readPeopleSummary(ctx.organizationId);
}

/**
 * What the club's staff cost a month — `salarySummary`, the function Salários
 * answers from, so an Admin's figure excludes the Owner's pay by the same SQL
 * predicate and the card says so in words (`ownerExcluded`). Empty when the
 * club has no staff to cost.
 */
export async function staffCost(ctx: ResolverContext): Promise<SalarySummary | null> {
  const summary = await salarySummary(ctx.organizationId, {
    isOwner: ctx.roles.includes('owner'),
  });
  return summary.coverage.total === 0 ? null : summary;
}

/**
 * Qualifications âmbar, vermelho or em falta — POOLSE-27, 7b.2. Empty when
 * everybody is verde; the list is the five most urgent, worst first.
 */
export async function qualifications(ctx: ResolverContext): Promise<QualificationsWidget | null> {
  const widget = await readQualificationsWidget(ctx.organizationId);
  return widget.red + widget.amber + widget.missing === 0 ? null : widget;
}

/**
 * Pedidos de inscrição — POOLSE-69: requests waiting and trials booked. Empty
 * when there is nothing to answer, whether or not the form is open.
 */
export async function leads(ctx: ResolverContext): Promise<LeadsWidget | null> {
  const widget = await readLeadsWidget(ctx.organizationId);
  return widget.waiting + widget.trials === 0 ? null : widget;
}

/** A family that has waited three days for an answer is a family calling another club. */
export function leadHasWaited(data: unknown): boolean {
  return ((data as LeadsWidget | null)?.oldestWaitingDays ?? 0) >= 3;
}

/** An expired qualification is something somebody must act on this week. */
export function qualificationHasLapsed(data: unknown): boolean {
  return ((data as QualificationsWidget | null)?.red ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* The instructor band — slice 3                                              */
/* -------------------------------------------------------------------------- */

/**
 * The reader's next class. Empty when they teach nothing from now on — an
 * instructor between seasons, or one who has just been invited — which is a
 * sentence, not a failure (QA 6).
 */
export async function nextClass(ctx: ResolverContext): Promise<NextClass | null> {
  return readNextClass(ctx.organizationId, ctx.membershipId);
}

/** The register is open and nobody has taken it — that card belongs on top. */
export function registerIsOwed(data: unknown): boolean {
  const next = data as NextClass | null;
  return next !== null && next.registerOpen && !next.registerTaken;
}

export interface WeekWidget {
  classes: WeekClass[];
  /** Of those, how many are still to come and not cancelled. */
  remaining: number;
}

/** This week's classes. Empty on a week with none, cancelled ones included. */
export async function myWeek(ctx: ResolverContext): Promise<WeekWidget | null> {
  const classes = await readMyWeek(ctx.organizationId, ctx.membershipId);
  if (classes.length === 0) return null;
  return {
    classes,
    remaining: classes.filter((one) => !one.cancelled && !one.past).length,
  };
}

export interface TrainingPlanWidget {
  next: Pick<
    NextClass,
    'sessionId' | 'classGroupId' | 'className' | 'localDate' | 'localTime' | 'dayOffset' | 'weekday'
  >;
  written: boolean;
  /** The first line of what is written, so the card says what Tuesday holds. */
  excerpt: string | null;
  updatedBy: string | null;
  /** When the same turma's last plan was for — the copy button needs one. */
  previousOn: string | null;
  canEdit: boolean;
}

/** How much of a plan the card quotes. */
const EXCERPT_CHARS = 140;

/**
 * The next plannable lesson's plan — written, or missing.
 *
 * Read through `readLessonPlan`, the function the calendar's sheet answers
 * from, so "is there a plan" and "may I write it" are the same answers here as
 * there. The previous lesson's **body is not sent** — the card copies it with a
 * server action that re-reads it, so a stale browser cannot paste last month's
 * drills over a plan somebody wrote a minute ago.
 */
export async function nextTrainingPlan(ctx: ResolverContext): Promise<TrainingPlanWidget | null> {
  const next = await readNextClass(ctx.organizationId, ctx.membershipId, { plannable: true });
  if (next === null) return null;

  const plan = await readLessonPlan(ctx.organizationId, next.sessionId, ctx.roles, ctx.membershipId);
  // The session was there a statement ago; gone now is a race, not an absence.
  if (plan === null) throw new Error('The next lesson vanished between two reads');

  const body = plan.body.trim();
  const firstLine = body.split('\n')[0]?.trim() ?? '';

  return {
    next: {
      sessionId: next.sessionId,
      // Null for a parceria the club runs: its plan opens on the calendar, not the register's page.
      classGroupId: next.classGroupId,
      className: next.className,
      localDate: next.localDate,
      localTime: next.localTime,
      dayOffset: next.dayOffset,
      weekday: next.weekday,
    },
    written: body !== '',
    excerpt:
      body === ''
        ? null
        : firstLine.length > EXCERPT_CHARS
          ? `${firstLine.slice(0, EXCERPT_CHARS - 1)}…`
          : firstLine,
    updatedBy: plan.updatedBy,
    previousOn: plan.previous?.onDate ?? null,
    canEdit: plan.canEdit,
  };
}

/** A lesson inside two days with no plan is worth saying first. */
export function planIsMissingSoon(data: unknown): boolean {
  const plan = data as TrainingPlanWidget | null;
  return plan !== null && !plan.written && plan.next.dayOffset <= 1;
}

export interface MyTurmasWidget {
  total: number;
  turmas: MyTurma[];
}

/** How many turmas a card lists before the link takes over. */
const TURMAS_SHOWN = 6;

/** The turmas I am responsible for. Empty for a stand-in who owns none. */
export async function myTurmas(ctx: ResolverContext): Promise<MyTurmasWidget | null> {
  const turmas = await readMyTurmas(ctx.organizationId, ctx.membershipId);
  if (turmas.length === 0) return null;
  return { total: turmas.length, turmas: turmas.slice(0, TURMAS_SHOWN) };
}

/* -------------------------------------------------------------------------- */
/* The maintenance band — slice 4                                             */
/* -------------------------------------------------------------------------- */

/*
 * Every one of these reads `ownFacilityIds` — the sites the reader works at,
 * whatever the management selector says (AC 10).
 */

/** Open avarias, worst first. Empty is good news: nothing broken. */
export async function maintenanceFaults(ctx: ResolverContext): Promise<OpenFaults | null> {
  const faults = await readOpenFaults(ctx.organizationId, ctx.membershipId, ctx.ownFacilityIds);
  return faults.total === 0 ? null : faults;
}

/** A high-severity avaria belongs at the top of the band. */
export function faultNeedsSomebody(data: unknown): boolean {
  const faults = data as OpenFaults | null;
  return faults !== null && faults.high > 0;
}

/** Rooms past their cleaning interval. Empty when every room is on time. */
export async function overdueCleanings(ctx: ResolverContext): Promise<OverdueSpaces | null> {
  const overdue = await readOverdueSpaces(ctx.organizationId, ctx.ownFacilityIds);
  return overdue.total === 0 ? null : overdue;
}

/**
 * The owner's water card, over every site the reader works at — the same
 * function, so the two cards cannot disagree about whether a tank is due.
 */
export async function ownWaterQuality(ctx: ResolverContext): Promise<WaterQualityWidget | null> {
  return waterQuality({ ...ctx, facilityIds: ctx.ownFacilityIds });
}

/** Open reposições and this week's lost property. Empty when both are. */
export async function inventoryWatch(ctx: ResolverContext): Promise<InventoryWatch | null> {
  const watch = await readInventoryWatch(ctx.organizationId, ctx.ownFacilityIds);
  return watch.restockTotal === 0 && watch.lostTotal === 0 ? null : watch;
}


/* -------------------------------------------------------------------------- */
/* The personal band — slice 5, 15 October 2026                               */
/* -------------------------------------------------------------------------- */

/*
 * Every one of these is about `ctx.childStudentId`, which the controller chose
 * from the reader's own records; compose leaves the band out when there is
 * none, so the non-null assertion below is a statement of that rule rather than
 * a hope. Nothing here is money the office decides with: no discount reasons,
 * no prices on offer — the family path of the fee read already leaves those out.
 */
function child(ctx: ResolverContext): string {
  if (ctx.childStudentId === undefined || ctx.childStudentId === null) {
    throw new Error('A personal widget was resolved with no child chosen');
  }
  return ctx.childStudentId;
}

/** The child's next lesson. Empty between seasons, which is a sentence. */
export async function childNextClass(ctx: ResolverContext): Promise<ChildNextClass | null> {
  return readChildNextClass(ctx.organizationId, child(ctx));
}

export interface ChildPlanWidget {
  next: Pick<ChildNextClass, 'sessionId' | 'className' | 'localDate' | 'localTime' | 'dayOffset' | 'weekday'>;
  /** The whole plan, read-only; empty when nothing is written yet. */
  body: string;
}

/**
 * The next lesson's plan, read-only and without its author — the rule a
 * family's plan read follows on the record's Semana. Empty when there is no
 * next lesson; `body: ''` when there is one and nothing is written.
 */
export async function childPlan(ctx: ResolverContext): Promise<ChildPlanWidget | null> {
  const next = await readChildNextClass(ctx.organizationId, child(ctx));
  if (next === null) return null;

  const plan = await readLessonPlan(ctx.organizationId, next.sessionId, ctx.roles, ctx.membershipId);
  if (plan === null) throw new Error('The next lesson vanished between two reads');

  return {
    next: {
      sessionId: next.sessionId,
      className: next.className,
      localDate: next.localDate,
      localTime: next.localTime,
      dayOffset: next.dayOffset,
      weekday: next.weekday,
    },
    body: plan.body.trim(),
  };
}

/** This month's register for the child. Empty before anything is held. */
export async function childAttendance(ctx: ResolverContext): Promise<ChildAttendance | null> {
  return readChildAttendance(ctx.organizationId, child(ctx));
}

export interface ChildFeesWidget extends FeeBalance {
  /** How many running lines there are — the card says "1 mensalidade" or more. */
  lines: number;
}

/**
 * What the family owes — `balance` from the fee read, the same figure the
 * record's Mensalidades tab shows. Empty when nothing is agreed.
 */
export async function childFees(ctx: ResolverContext): Promise<ChildFeesWidget | null> {
  const fees = await studentFees(ctx.organizationId, child(ctx));
  const lines = fees.lines.filter((line) => line.endsOn === null).length;
  if (lines === 0) return null;
  return { ...fees.balance, lines };
}

/** Something is overdue: the family should read that first. */
export function feesAreOverdue(data: unknown): boolean {
  return ((data as ChildFeesWidget | null)?.overdueCount ?? 0) > 0;
}

/**
 * The water at the pool of the child's next lesson — temperature only. Empty
 * with no next lesson or no temperature recorded there.
 */
export async function childWater(ctx: ResolverContext): Promise<PoolTemperature | null> {
  const next = await readChildNextClass(ctx.organizationId, child(ctx));
  if (next === null || next.poolId === null) return null;
  return readPoolTemperature(ctx.organizationId, next.poolId);
}
