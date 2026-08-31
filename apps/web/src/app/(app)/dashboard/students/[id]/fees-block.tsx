'use client';

import { useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { formatCents, monthlyEquivalentCents } from '@/lib/money';
import type { CurrentPlan, FeePeriod, StudentFeeLine, StudentFees } from '@/lib/api';
import type { FormState } from '../../actions';
import {
  addFeeAction,
  archiveFeeAction,
  markPaidAction,
  repriceFeeAction,
  saveSocioAction,
  updateFeeAction,
} from './fees.actions';

/**
 * What this student pays — POOLSE-42, AC3.
 *
 * **The plan is read off the timetable, never chosen.** A child in Iniciação
 * twice a week is on the Iniciação-twice-a-week price; asking an operator to
 * pick that from a list was asking them to restate what their turmas already
 * say, and to get it wrong the week they changed turma.
 *
 * **The total is the sum of the lines, never a number anybody typed.** A student
 * in two turmas has two mensalidades; a sócio has a quota beside them. The
 * office's question is "what does this family pay", and a single maintained
 * figure would be wrong the first time a child changed turma.
 *
 * Grouped by site, because a student enrolled at two pools has lines from two
 * price lists and reading them interleaved tells nobody which agreement is
 * which.
 *
 * Every amount here arrived from the API already computed. Nothing on this
 * screen multiplies or discounts anything — `fee_total_cents` in Postgres is the
 * one definition, and a second one here would agree until the first awkward
 * rounding.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * What to call a line, now that a plan has no name.
 *
 * "Iniciação · 2x/semana" for a mensalidade, and the quota is simply the quota —
 * a club has one, and naming it would be naming the only thing in its category.
 */
function lineLabel(
  line: { kind: 'mensalidade' | 'quota'; levelName: string | null; lessonsPerWeek: number | null },
  // next-intl's own translator type, taken from the hook rather than described
  // again here — a hand-written signature drifts from theirs at the first change.
  t: ReturnType<typeof useTranslations>,
): string {
  if (line.kind === 'quota') return t('fees.kind.quota');
  const level = line.levelName ?? t('students.noLevel');
  return `${level} · ${t('fees.lessonsAWeek', { count: line.lessonsPerWeek ?? 1 })}`;
}

function Problem({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined && state.fields === undefined) return null;

  return (
    <p className="text-sm text-danger">
      {state.errorKey !== undefined
        ? t(state.errorKey)
        : Object.values(state.fields ?? {}).map((key) => t(key)).join(' ')}
    </p>
  );
}

export function FeesBlock({
  studentId,
  fees,
  periods,
}: {
  studentId: string;
  fees: StudentFees;
  periods: Record<string, FeePeriod[]>;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  const live = fees.lines.filter((line) => line.endsOn === null);
  const ended = fees.lines.filter((line) => line.endsOn !== null);

  /*
   * What this family pays, everything included — the mensalidades and the quota.
   *
   * The per-site totals below answer "what is the agreement at this pool"; this
   * answers the question the office is actually asked at the counter. Both are
   * shown because a student at two sites has two agreements and one bill.
   */
  const grandTotal = live.reduce((sum, line) => sum + line.payableCents, 0);

  /*
   * What is still owed, with the late penalty on top.
   *
   * One penalty however many lines are late — "the student pays a penalty" —
   * and it is added here rather than written as a charge: an automatic fee with
   * nobody's name against it has to be defensible at a counter.
   */
  const outstanding =
    live.filter((line) => !line.isPaid).reduce((sum, line) => sum + line.payableCents, 0) +
    fees.penaltyCents;

  // Grouped by site. The key is the facility, so two sites never share a total.
  const sites = [...new Set(live.map((line) => line.facilityId))];

  return (
    <section className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('fees.studentTitle')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">{t('fees.studentHint')}</p>
      </div>

      {/*
        What the timetable says they are on, before anything about money.

        First on the card because it is the answer to "why does this student pay
        this", and because it is the only part of the card nobody maintains by
        hand.
      */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-medium">{t('fees.currentPlan')}</h3>

        {fees.currentPlans.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('fees.noClasses')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {fees.currentPlans.map((plan) => (
              <CurrentPlanRow
                key={`${plan.facilityId}-${plan.levelId ?? 'none'}`}
                studentId={studentId}
                plan={plan}
                periods={periods[plan.facilityId] ?? []}
                showSite={fees.currentPlans.some(
                  (other) => other.facilityId !== plan.facilityId,
                )}
              />
            ))}
          </ul>
        )}
      </div>

      {live.length === 0 && <p className="text-sm text-foreground-muted">{t('fees.noLines')}</p>}

      {sites.map((facilityId) => {
        const siteLines = live.filter((line) => line.facilityId === facilityId);
        const total = siteLines.reduce((sum, line) => sum + line.payableCents, 0);
        const monthly = siteLines.reduce(
          (sum, line) => sum + monthlyEquivalentCents(line.payableCents, line.months),
          0,
        );

        return (
          <div key={facilityId} className="flex flex-col gap-3">
            {sites.length > 1 && (
              <h3 className="text-sm font-medium">{siteLines[0]?.facilityName}</h3>
            )}

            <ul className="flex flex-col divide-y divide-border">
              {siteLines.map((line) => (
                <FeeRow
                  key={line.id}
                  studentId={studentId}
                  line={line}
                  periods={periods[line.facilityId] ?? []}
                />
              ))}
            </ul>

            {/*
              The sum, and what it works out at per month. Both, because they
              answer different questions — what will be charged, and whether
              paying ahead is worth it.
            */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-border pt-3">
              <span className="font-medium">{t('fees.total')}</span>
              <span className="flex flex-col items-end">
                <span className="text-lg font-medium tabular-nums">
                  {formatCents(locale, total)}
                </span>
                <span className="text-sm text-foreground-muted tabular-nums">
                  {t('fees.perMonth', { amount: formatCents(locale, Math.round(monthly)) })}
                </span>
              </span>
            </div>
          </div>
        );
      })}

      {/*
        The one number somebody reads out loud. Shown once, under everything,
        including the quota — which is a line like any other and so is already in
        the sum rather than added on afterwards by this component.
      */}
      {live.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded bg-surface-muted p-4">
          <span className="font-medium">{t('fees.grandTotal')}</span>
          <span className="flex flex-col items-end">
            <span className="text-xl font-medium tabular-nums">
              {formatCents(locale, grandTotal)}
            </span>
            {outstanding > 0 ? (
              <span className="flex flex-col items-end">
                <span className="text-sm text-warning tabular-nums">
                  {t('fees.outstanding', { amount: formatCents(locale, outstanding) })}
                </span>
                {/*
                  Each penalty named for what it is on — round 5. A club may fine
                  a late mensalidade and forgive a late quota, and a single
                  figure could not be checked against either rule.
                */}
                {fees.penalties.mensalidadeCents > 0 && (
                  <span className="flex items-center gap-1.5 text-sm text-danger">
                    <AlertTriangle aria-hidden className="size-3.5" />
                    {t('fees.penaltyMensalidadeApplied', {
                      amount: formatCents(locale, fees.penalties.mensalidadeCents),
                    })}
                  </span>
                )}
                {fees.penalties.quotaCents > 0 && (
                  <span className="flex items-center gap-1.5 text-sm text-danger">
                    <AlertTriangle aria-hidden className="size-3.5" />
                    {t('fees.penaltyQuotaApplied', {
                      amount: formatCents(locale, fees.penalties.quotaCents),
                    })}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-primary">
                <Check aria-hidden className="size-4" />
                {t('fees.allPaid')}
              </span>
            )}
          </span>
        </div>
      )}

      {ended.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-foreground-muted hover:text-foreground">
            {t('fees.endedCount', { count: ended.length })}
          </summary>
          <ul className="flex flex-col divide-y divide-border pt-2">
            {ended.map((line) => (
              <li
                key={line.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-foreground-muted"
              >
                <span>{lineLabel(line, t)}</span>
                <span className="tabular-nums">{formatCents(locale, line.payableCents)}</span>
                <span>{t('fees.endedOn', { date: line.endsOn ?? '' })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <SocioForm studentId={studentId} socio={fees.socio} />
    </section>
  );
}

function FeeRow({
  studentId,
  line,
  periods,
}: {
  studentId: string;
  line: StudentFeeLine;
  periods: FeePeriod[];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [editing, setEditing] = useState(false);

  const [, reprice, repricing] = useSavedAction(repriceFeeAction, INITIAL);
  const [, archive, archiving] = useSavedAction(archiveFeeAction, INITIAL);
  const [, markPaid, marking] = useSavedAction(markPaidAction, INITIAL);

  const discounted = line.payableCents !== line.periodTotalCents;

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{lineLabel(line, t)}</span>
          <span className="text-sm text-foreground-muted">
            {line.classGroupName !== null && `${line.classGroupName} · `}
            {line.periodName}
          </span>
        </span>

        <span className="flex flex-col items-end">
          <span className="tabular-nums font-medium">
            {formatCents(locale, line.payableCents)}
          </span>
          <span className="text-sm text-foreground-muted tabular-nums">
            {t('fees.perMonth', {
              amount: formatCents(
                locale,
                Math.round(monthlyEquivalentCents(line.payableCents, line.months)),
              ),
            })}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="text-foreground-muted">
          {t('fees.baseAmount', { amount: formatCents(locale, line.amountCents) })}
        </span>

        {line.discountPercent > 0 && (
          <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">
            {t('fees.periodDiscount', { discount: line.discountPercent })}
          </span>
        )}

        {discounted && (
          <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">
            {t('fees.manualDiscount', { reason: line.discountReason ?? '' })}
          </span>
        )}

        {/*
          The out-of-date marker — AC5 and QA 42.13.

          Text and an icon, never colour alone. The API sends the current plan
          amount only when it differs, so there is no rule here to get wrong.
        */}
        {line.planAmountCentsNow !== null && (
          <span className="flex items-center gap-1.5 rounded bg-warning/10 px-2 py-0.5 text-warning">
            <AlertTriangle aria-hidden className="size-3.5" />
            {/*
              A quota can move because the member crossed eighteen rather than
              because the club changed its mind. Different sentence, same one
              click — and saying "the list changed" would have been untrue.
            */}
            {t(line.bandChanged ? 'fees.bandChanged' : 'fees.outOfDate', {
              amount: formatCents(locale, line.planAmountCentsNow),
            })}
          </span>
        )}

        {/*
          Paid, by hand — a form rather than a checkbox with an onChange, so it
          works before any JavaScript has loaded and so the state on screen is
          always the state on the server rather than an optimistic guess.

          Text beside the mark, never colour alone.
        */}
        <form action={markPaid} className="flex items-center">
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="feeId" value={line.id} />
          <input type="hidden" name="isPaid" value={line.isPaid ? 'false' : 'true'} />
          <input type="hidden" name="periodStart" value={line.currentPeriodStart ?? ''} />
          <button
            type="submit"
            // An ended line has no occurrence to settle, so there is nothing to
            // press — and pressing it would write a payment for a null period.
            disabled={marking || line.currentPeriodStart === null}
            aria-pressed={line.isPaid}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-0.5',
              line.isPaid && 'bg-primary/10 text-primary',
              !line.isPaid && line.isOverdue && 'bg-danger/10 text-danger',
              !line.isPaid && !line.isOverdue &&
                'border border-border text-foreground-muted hover:bg-surface-muted',
            )}
          >
            <Check aria-hidden className={cn('size-3.5', !line.isPaid && 'opacity-40')} />
            {line.isPaid
              ? t('fees.paidOn', { date: line.paidOn ?? '' })
              : line.isOverdue
                ? t('fees.overdueSince', { date: line.dueOn ?? '' })
                : t('fees.dueBy', { date: line.dueOn ?? '' })}
          </button>
        </form>

        <span className="ml-auto flex gap-2">
          {line.planAmountCentsNow !== null && (
            <form action={reprice}>
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="feeId" value={line.id} />
              <button type="submit" disabled={repricing} className={BUTTON_QUIET}>
                <RefreshCw aria-hidden className="mr-1 inline size-3.5" />
                {t('fees.reprice')}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            aria-expanded={editing}
            className={BUTTON_QUIET}
          >
            {t('fees.edit')}
          </button>

          <form action={archive}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="feeId" value={line.id} />
            <button
              type="submit"
              disabled={archiving}
              className={BUTTON_QUIET}
              aria-label={t('fees.removeLine')}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          </form>
        </span>
      </div>

      {/*
        How this family pays, on the line rather than behind "Editar" — round 5.

        The periodicity is the student's decision, not the price list's: the
        facility sets what a month costs and what each period discounts, and the
        family says which of them they want. The plan's default only seeds it.
      */}
      <PeriodPicker studentId={studentId} line={line} periods={periods} />

      {editing && (
        <EditFeeForm
          studentId={studentId}
          line={line}
          periods={periods}
          onDone={() => setEditing(false)}
        />
      )}
    </li>
  );
}

/**
 * The one field on a line a family actually chooses.
 *
 * Its own small form so it can be changed without opening the editor — and it
 * carries the line's discount and end date as hidden fields, because the update
 * endpoint takes the whole line and a partial form would quietly clear the
 * discount somebody negotiated.
 */
function PeriodPicker({
  studentId,
  line,
  periods,
}: {
  studentId: string;
  line: StudentFeeLine;
  periods: FeePeriod[];
}): React.ReactElement {
  const t = useTranslations();
  const [periodId, setPeriodId] = useState(line.periodId);
  const [state, submit, pending] = useSavedAction(updateFeeAction, INITIAL);

  const discountKind =
    line.manualDiscountPercent !== null
      ? 'percent'
      : line.manualDiscountCents !== null
        ? 'amount'
        : 'none';
  const discountValue =
    line.manualDiscountPercent !== null
      ? String(line.manualDiscountPercent)
      : line.manualDiscountCents !== null
        ? (line.manualDiscountCents / 100).toFixed(2)
        : '';

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="feeId" value={line.id} />
      <input type="hidden" name="endsOn" value={line.endsOn ?? ''} />
      <input type="hidden" name="discountKind" value={discountKind} />
      <input type="hidden" name="discountValue" value={discountValue} />
      <input type="hidden" name="discountReason" value={line.discountReason ?? ''} />

      <div className={cn(FIELD_COLUMN, 'max-w-xs')}>
        <label htmlFor={`pay-${line.id}`} className={FIELD_LABEL}>
          {t('fees.howTheyPay')}
        </label>
        <select
          id={`pay-${line.id}`}
          name="feePeriodId"
          value={periodId}
          onChange={(event) => setPeriodId(event.target.value)}
          className={CONTROL_LINE}
        >
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {period.name}
            </option>
          ))}
        </select>
      </div>

      {/* Only once it would do something. A save button beside an unchanged
          select invites a click that means nothing. */}
      {periodId !== line.periodId && (
        <button type="submit" disabled={pending} className={BUTTON_QUIET}>
          {t('fees.save')}
        </button>
      )}

      <Problem state={state} />
    </form>
  );
}

/** The discount controls, shared by the add and edit forms so they cannot drift. */
function DiscountFields({
  idPrefix,
  line,
}: {
  idPrefix: string;
  line?: StudentFeeLine;
}): React.ReactElement {
  const t = useTranslations();
  const [kind, setKind] = useState<'none' | 'percent' | 'amount'>(
    line?.manualDiscountPercent !== null && line?.manualDiscountPercent !== undefined
      ? 'percent'
      : line?.manualDiscountCents !== null && line?.manualDiscountCents !== undefined
        ? 'amount'
        : 'none',
  );

  return (
    <>
      <div className={cn(FIELD_COLUMN, 'max-w-none')}>
        <label htmlFor={`${idPrefix}-dkind`} className={FIELD_LABEL}>
          {t('fees.discountKind')}
        </label>
        <select
          id={`${idPrefix}-dkind`}
          name="discountKind"
          value={kind}
          onChange={(event) => setKind(event.target.value as 'none' | 'percent' | 'amount')}
          className={CONTROL_LINE}
        >
          <option value="none">{t('fees.noDiscount')}</option>
          <option value="percent">{t('fees.discountPercentKind')}</option>
          <option value="amount">{t('fees.discountAmountKind')}</option>
        </select>
      </div>

      {kind !== 'none' && (
        <>
          <div className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor={`${idPrefix}-dvalue`} className={FIELD_LABEL}>
              {kind === 'percent' ? t('fees.discountPercent') : t('fees.discountAmount')}
            </label>
            <input
              id={`${idPrefix}-dvalue`}
              name="discountValue"
              inputMode="decimal"
              defaultValue={
                line?.manualDiscountPercent !== null && line?.manualDiscountPercent !== undefined
                  ? String(line.manualDiscountPercent)
                  : line?.manualDiscountCents !== null && line?.manualDiscountCents !== undefined
                    ? (line.manualDiscountCents / 100).toFixed(2)
                    : ''
              }
              className={CONTROL_LINE}
            />
          </div>

          <div className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor={`${idPrefix}-dreason`} className={FIELD_LABEL}>
              {t('fees.discountReason')}
            </label>
            <input
              id={`${idPrefix}-dreason`}
              name="discountReason"
              defaultValue={line?.discountReason ?? ''}
              required
              maxLength={500}
              className={CONTROL_LINE}
            />
            {/* Required by the database as well. Siblings, staff children, a
                negotiated case — all defensible, none of them guessable later. */}
            <p className="text-sm text-foreground-muted">{t('fees.discountReasonHint')}</p>
          </div>
        </>
      )}
    </>
  );
}

/**
 * One line of "what their turmas come to".
 *
 * It reports a fact and, when that fact is not yet being charged, offers to
 * charge it. Nothing here picks a plan — the level and the number of weekly
 * sessions decide which price applies, and the only thing left for a person to
 * say is how often the family pays.
 */
function CurrentPlanRow({
  studentId,
  plan,
  periods,
  showSite,
}: {
  studentId: string;
  plan: CurrentPlan;
  periods: FeePeriod[];
  showSite: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [charging, setCharging] = useState(false);

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">
            {plan.levelName ?? t('students.noLevel')} ·{' '}
            {t('fees.lessonsAWeek', { count: plan.lessonsPerWeek })}
          </span>
          {showSite && (
            <span className="text-sm text-foreground-muted">{plan.facilityName}</span>
          )}
        </span>

        <span className="flex flex-wrap items-center gap-3">
          {plan.amountCents === null ? (
            /*
              A combination the site never priced. Said here, where somebody can
              act on it, rather than silently costing nothing.
            */
            <span className="flex items-center gap-1.5 rounded bg-warning/10 px-2 py-0.5 text-sm text-warning">
              <AlertTriangle aria-hidden className="size-3.5" />
              {t('fees.noPriceForClasses')}
            </span>
          ) : (
            <span className="tabular-nums">
              {t('fees.perMonth', { amount: formatCents(locale, plan.amountCents) })}
            </span>
          )}

          {plan.hasLine ? (
            <span className="flex items-center gap-1.5 text-sm text-primary">
              <Check aria-hidden className="size-4" />
              {t('fees.beingCharged')}
            </span>
          ) : (
            plan.planId !== null &&
            !charging && (
              <button
                type="button"
                onClick={() => setCharging(true)}
                className={BUTTON_QUIET}
              >
                <Plus aria-hidden className="mr-1 inline size-3.5" />
                {t('fees.chargeThisPlan')}
              </button>
            )
          )}
        </span>
      </div>

      {charging && plan.planId !== null && (
        <ChargePlanForm
          studentId={studentId}
          planId={plan.planId}
          periods={periods}
          suggestedPeriodId={plan.defaultFeePeriodId}
          onDone={() => setCharging(false)}
        />
      )}
    </li>
  );
}

/**
 * Start charging the price the classes imply.
 *
 * The plan is not on this form — it came from the row. What is left is how often
 * the family pays, and any discount that was negotiated.
 */
function ChargePlanForm({
  studentId,
  planId,
  periods,
  suggestedPeriodId,
  onDone,
}: {
  studentId: string;
  planId: string;
  periods: FeePeriod[];
  suggestedPeriodId: string | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();

  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await addFeeAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  // The plan's own preference, then the site's — AC2.
  const suggested =
    suggestedPeriodId ?? periods.find((period) => period.isDefault)?.id ?? periods[0]?.id ?? '';

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-4">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="feePlanId" value={planId} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`charge-${planId}-period`} className={FIELD_LABEL}>
            {t('fees.period')}
          </label>
          <select
            id={`charge-${planId}-period`}
            name="feePeriodId"
            key={suggested}
            defaultValue={suggested}
            required
            className={CONTROL_LINE}
          >
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </div>

        <DiscountFields idPrefix={`charge-${planId}`} />
      </div>

      <Problem state={state} />

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('fees.chargeThisPlan')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('fees.cancel')}
        </button>
      </div>
    </form>
  );
}

function EditFeeForm({
  studentId,
  line,
  periods,
  onDone,
}: {
  studentId: string;
  line: StudentFeeLine;
  periods: FeePeriod[];
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await updateFeeAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="feeId" value={line.id} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`edit-period-${line.id}`} className={FIELD_LABEL}>
            {t('fees.period')}
          </label>
          <select
            id={`edit-period-${line.id}`}
            name="feePeriodId"
            defaultValue={line.periodId}
            className={CONTROL_LINE}
          >
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </div>

        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`edit-ends-${line.id}`} className={FIELD_LABEL}>
            {t('fees.endsOn')}
          </label>
          <input
            id={`edit-ends-${line.id}`}
            name="endsOn"
            type="date"
            defaultValue={line.endsOn ?? ''}
            className={CONTROL_LINE}
          />
        </div>

        <DiscountFields idPrefix={`edit-${line.id}`} line={line} />
      </div>

      <Problem state={state} />

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('fees.save')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('fees.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * Sócio — AC6.
 *
 * Its own form because it is a fact about the person rather than a fee line: a
 * member with a waived quota is an ordinary case, and modelling the toggle as
 * "has a quota line" would make them unrepresentable.
 */
function SocioForm({
  studentId,
  socio,
}: {
  studentId: string;
  socio: StudentFees['socio'];
}): React.ReactElement {
  const t = useTranslations();
  const [isSocio, setIsSocio] = useState(socio.isSocio);
  /*
   * Controlled, like every other field in this app: React 19 resets a form as
   * soon as an action returns, including when it returns "that number is
   * already somebody else's" — which would wipe what was just typed at the
   * exact moment somebody is being asked to correct it.
   */
  const [number, setNumber] = useState(socio.socioNumber ?? '');
  const [since, setSince] = useState(socio.socioSince ?? '');
  const [state, submit, pending] = useSavedAction(saveSocioAction, INITIAL);

  const numberError = state.fields?.socioNumber;

  return (
    <form action={submit} className="flex flex-col gap-3 border-t border-border pt-4">
      <input type="hidden" name="studentId" value={studentId} />

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="isSocio"
          checked={isSocio}
          onChange={(event) => setIsSocio(event.target.checked)}
          className="size-4"
        />
        {t('fees.isSocio')}
      </label>

      {isSocio && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor="socio-number" className={FIELD_LABEL}>
              {t('fees.socioNumber')}
            </label>
            <input
              id="socio-number"
              name="socioNumber"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              maxLength={40}
              aria-invalid={numberError !== undefined}
              aria-describedby={numberError === undefined ? undefined : 'socio-number-error'}
              className={CONTROL_LINE}
            />
            {/* A number identifies one member, so the refusal belongs beside the
                box rather than at the foot of the card. */}
            {numberError !== undefined && (
              <p id="socio-number-error" className="text-sm text-danger">
                {t(numberError)}
              </p>
            )}
            <p className="text-sm text-foreground-muted">{t('fees.socioNumberHint')}</p>
          </div>

          <div className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor="socio-since" className={FIELD_LABEL}>
              {t('fees.socioSince')}
            </label>
            <input
              id="socio-since"
              name="socioSince"
              type="date"
              value={since}
              onChange={(event) => setSince(event.target.value)}
              className={CONTROL_LINE}
            />
          </div>
        </div>
      )}

      <p className="text-sm text-foreground-muted">{t('fees.socioHint')}</p>

      <Problem state={state} />

      <button type="submit" disabled={pending} className={cn(BUTTON, 'self-start')}>
        {t('fees.save')}
      </button>
    </form>
  );
}
