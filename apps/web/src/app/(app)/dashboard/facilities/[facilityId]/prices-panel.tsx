'use client';

import { Fragment, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { centsToInput, formatCents, parseCents } from '@/lib/money';
import type {
  BillingSettings,
  FeeAgeBand,
  FeePenaltyKind,
  FeePeriod,
  FeePlan,
  StudentLevel,
} from '@/lib/api';
import type { FormState } from '../../actions';
import {
  archivePeriodAction,
  archivePlanAction,
  saveBillingAction,
  savePeriodAction,
  savePlanAction,
} from './prices.actions';

/**
 * A facility's prices — POOLSE-42, second pass.
 *
 * Four things a club decides about money, in the order they depend on each
 * other: how often somebody may pay, what each level costs at each frequency,
 * what the membership costs, and when a payment is late.
 *
 * **A price is a level and a frequency.** There is no plan name: the ladder
 * already says what a level is called, and asking an operator to invent a label
 * for "Iniciação, twice a week" was asking them to name a cell in a grid.
 *
 * The quota is its own section rather than one more row in the price list. It is
 * one number a club sets once and is not part of the level grid, so reading it
 * as an exception in a list of levels made it look like a level.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Says the save happened.
 *
 * Every one of these forms saves values that are already on screen, so a
 * successful save looked exactly like a broken button — which is what it was
 * reported as. Nothing else in this app has that problem because everything else
 * either navigates or visibly changes.
 */
function Saved({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (!state.ok) return null;

  return (
    <p className="flex items-center gap-1.5 text-sm text-primary">
      <Check aria-hidden className="size-4" />
      {t('fees.saved')}
    </p>
  );
}

function Problem({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined && state.fields === undefined) return null;

  return (
    <p className="text-sm text-danger">
      {state.errorKey !== undefined
        ? t(state.errorKey)
        : Object.values(state.fields ?? {}).map((key) => t(key)).join(' ')}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

export function PricesPanel({
  facilityId,
  plans,
  periods,
  levels,
  billing,
  canManage,
}: {
  facilityId: string;
  plans: FeePlan[];
  periods: FeePeriod[];
  levels: StudentLevel[];
  billing: BillingSettings;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<string | null>(null);
  const [addingPlan, setAddingPlan] = useState(false);
  const [addingQuota, setAddingQuota] = useState(false);

  const mensalidades = plans.filter((plan) => plan.kind === 'mensalidade');
  const quotas = plans.filter((plan) => plan.kind === 'quota');

  return (
    <section className="flex flex-col gap-6 rounded border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <Wallet aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('fees.pricesTitle')}
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">{t('fees.pricesHint')}</p>
        </div>
      </div>

      {/* ---- what a place costs -------------------------------------------- */}
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-base font-semibold">{t('fees.levelPrices')}</h3>
          <p className="mt-0.5 text-sm text-foreground-muted">{t('fees.levelPricesHint')}</p>
        </div>

        {mensalidades.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('fees.noPlans')}</p>
        ) : (
          /*
           * A table, not a stack of rows.
           *
           * The price list is a grid — level down, frequency across — and reading
           * it as prose meant three facts per line with nothing lining up. Scrolls
           * inside itself on a narrow screen rather than widening the page.
           */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-foreground-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('fees.level')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('fees.lessonsPerWeek')}</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    {t('fees.amount')}
                  </th>
                  {canManage && <th scope="col" className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {mensalidades.map((plan) => (
                  <Fragment key={plan.id}>
                    <tr className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 align-top">
                        <span className="font-medium">{plan.levelName}</span>
                        {/*
                          Whose fee this number moves.

                          Matched by level and weekly sessions, the same rule the
                          student's own plan follows — so an operator editing an
                          amount can see the turmas it lands on rather than
                          finding out from a parent.
                        */}
                        <span className="mt-0.5 block text-sm text-foreground-muted">
                          {plan.classGroups.length === 0
                            ? t('fees.noTurmas')
                            : plan.classGroups.map((group) => group.name).join(' · ')}
                        </span>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{plan.lessonsPerWeek}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatCents(locale, plan.amountCents)}
                      </td>
                      {canManage && (
                        <td className="py-2">
                          <span className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setEditingPlan(editingPlan === plan.id ? null : plan.id)
                              }
                              className={BUTTON_QUIET}
                              aria-expanded={editingPlan === plan.id}
                              aria-label={t('fees.edit')}
                            >
                              <Pencil aria-hidden className="size-3.5" />
                            </button>
                            <ArchiveForm
                              facilityId={facilityId}
                              idName="planId"
                              id={plan.id}
                              action={archivePlanAction}
                              label={t('fees.archivePlan')}
                            />
                          </span>
                        </td>
                      )}
                    </tr>
                    {editingPlan === plan.id && (
                      <tr>
                        <td colSpan={canManage ? 4 : 3} className="pb-3">
                          <PlanForm
                            facilityId={facilityId}
                            plan={plan}
                            kind="mensalidade"
                            periods={periods}
                            levels={levels}
                            onDone={() => setEditingPlan(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage &&
          (addingPlan ? (
            <PlanForm
              facilityId={facilityId}
              plan={null}
              kind="mensalidade"
              periods={periods}
              levels={levels}
              onDone={() => setAddingPlan(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingPlan(true)}
              className="self-start text-sm text-primary hover:underline"
            >
              <Plus aria-hidden className="mr-1 inline size-3.5" />
              {t('fees.addLevelPrice')}
            </button>
          ))}
      </div>

      {/* ---- the quota, on its own ------------------------------------------ */}
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <div>
          <h3 className="text-base font-semibold">{t('fees.quotaTitle')}</h3>
          <p className="mt-0.5 text-sm text-foreground-muted">{t('fees.quotaHint')}</p>
        </div>

        {quotas.length === 0 && !canManage && (
          <p className="text-sm text-foreground-muted">{t('fees.noQuota')}</p>
        )}

        {/*
          A short list rather than one amount — round 5.

          Most clubs charge one rate and this stays a single line. A club that
          charges children less writes a second row, and the banded row wins for
          the members it names: nothing about the first row has to change.
        */}
        <ul className="flex flex-col divide-y divide-border">
          {quotas.map((quota) => (
            <li key={quota.id} className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-medium">{t(`fees.band.${quota.ageBand}`)}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-lg font-medium">
                    {formatCents(locale, quota.amountCents)}
                  </span>
                  {canManage && (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingPlan(editingPlan === quota.id ? null : quota.id)}
                        aria-expanded={editingPlan === quota.id}
                        aria-label={t('fees.edit')}
                        className={BUTTON_QUIET}
                      >
                        <Pencil aria-hidden className="size-3.5" />
                      </button>
                      <ArchiveForm
                        facilityId={facilityId}
                        idName="planId"
                        id={quota.id}
                        action={archivePlanAction}
                        label={t('fees.archivePlan')}
                      />
                    </span>
                  )}
                </span>
              </div>

              {canManage && editingPlan === quota.id && (
                <PlanForm
                  facilityId={facilityId}
                  plan={quota}
                  kind="quota"
                  periods={periods}
                  levels={levels}
                  onDone={() => setEditingPlan(null)}
                />
              )}
            </li>
          ))}
        </ul>

        {canManage &&
          (addingQuota || quotas.length === 0 ? (
            <PlanForm
              facilityId={facilityId}
              plan={null}
              kind="quota"
              periods={periods}
              levels={levels}
              onDone={() => setAddingQuota(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingQuota(true)}
              className="self-start text-sm text-primary hover:underline"
            >
              <Plus aria-hidden className="mr-1 inline size-3.5" />
              {t('fees.addQuotaRate')}
            </button>
          ))}
      </div>

      {/* ---- when a payment is late, and what that costs -------------------- */}
      {/*
        Folded, like the periodicities: a club sets these once a season. The
        summary says the rule in words, so it does not have to be opened to be
        read — a tooltip may explain a control, but never be the only place a
        fact appears.
      */}
      <details className="border-t border-border pt-5">
        <summary className="cursor-pointer text-base font-semibold">
          {t('fees.paymentsTitle')}
          <span className="ml-2 text-sm font-normal text-foreground-muted">
            {t('fees.dueDaySummary', { day: billing.paymentDueDay })}
          </span>
        </summary>

        <div className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-foreground-muted">{t('fees.paymentsHint')}</p>

          {canManage ? (
            <BillingForm facilityId={facilityId} billing={billing} />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              <li>{t('fees.dueDaySummary', { day: billing.paymentDueDay })}</li>
              <li>
                {t('fees.penaltyMensalidadeLabel')}:{' '}
                {penaltyInWords(t, locale, billing.latePenaltyKind, billing.latePenaltyCents,
                                billing.latePenaltyPercent)}
              </li>
              <li>
                {t('fees.penaltyQuotaLabel')}:{' '}
                {penaltyInWords(t, locale, billing.quotaPenaltyKind, billing.quotaPenaltyCents,
                                billing.quotaPenaltyPercent)}
              </li>
            </ul>
          )}
        </div>
      </details>

      {/* ---- the setup nobody touches twice --------------------------------- */}
      <details className="border-t border-border pt-5">
        <summary className="cursor-pointer text-base font-semibold">
          {t('fees.periods')}
          <span className="ml-2 text-sm font-normal text-foreground-muted">
            {periods.length === 0
              ? t('fees.noPeriodsShort')
              : periods.map((period) => period.name).join(' · ')}
          </span>
        </summary>

        {/*
          Folded away, and last. A club decides its periodicities once and then
          spends its life editing prices — putting the rarely-touched thing at
          the top pushed the daily one below the fold.
        */}
        <div className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-foreground-muted">{t('fees.periodsHint')}</p>

          {periods.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {periods.map((period) => (
                <li key={period.id} className="flex flex-col gap-2 py-3 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">
                      {period.name}
                      {period.isDefault && (
                        <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          {t('fees.defaultPeriod')}
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-foreground-muted">
                      {t('fees.monthsAndDiscount', {
                        months: period.months,
                        discount: period.discountPercent,
                      })}
                    </span>
                    {canManage && (
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingPeriod(editingPeriod === period.id ? null : period.id)
                          }
                          className={BUTTON_QUIET}
                          aria-expanded={editingPeriod === period.id}
                          aria-label={t('fees.edit')}
                        >
                          <Pencil aria-hidden className="size-3.5" />
                        </button>
                        <ArchiveForm
                          facilityId={facilityId}
                          idName="periodId"
                          id={period.id}
                          action={archivePeriodAction}
                          label={t('fees.archivePeriod')}
                        />
                      </span>
                    )}
                  </div>

                  {editingPeriod === period.id && (
                    <PeriodForm
                      facilityId={facilityId}
                      period={period}
                      onDone={() => setEditingPeriod(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <details className="text-sm">
              <summary className="cursor-pointer text-primary hover:underline">
                <Plus aria-hidden className="mr-1 inline size-3.5" />
                {t('fees.addPeriod')}
              </summary>
              <div className="pt-3">
                <PeriodForm facilityId={facilityId} period={null} onDone={() => undefined} />
              </div>
            </details>
          )}
        </div>
      </details>

    </section>
  );
}

function ArchiveForm({
  facilityId,
  idName,
  id,
  action,
  label,
}: {
  facilityId: string;
  idName: string;
  id: string;
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  label: string;
}): React.ReactElement {
  const [, submit, pending] = useSavedAction(action, INITIAL);

  return (
    <form action={submit}>
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name={idName} value={id} />
      <button type="submit" disabled={pending} className={BUTTON_QUIET} aria-label={label}>
        <Trash2 aria-hidden className="size-3.5" />
      </button>
    </form>
  );
}

function PeriodForm({
  facilityId,
  period,
  onDone,
}: {
  facilityId: string;
  period: FeePeriod | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await savePeriodAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  const id = period?.id ?? 'new';

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      {period !== null && <input type="hidden" name="periodId" value={period.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`p-name-${id}`} className={FIELD_LABEL}>
            {t('fees.periodName')}
          </label>
          <input
            id={`p-name-${id}`}
            name="name"
            defaultValue={period?.name ?? ''}
            required
            maxLength={120}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`p-months-${id}`} className={FIELD_LABEL}>
            {t('fees.months')}
          </label>
          <input
            id={`p-months-${id}`}
            name="months"
            type="number"
            min={1}
            max={24}
            defaultValue={period?.months ?? 1}
            required
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`p-disc-${id}`} className={FIELD_LABEL}>
            {t('fees.discountPercent')}
          </label>
          <input
            id={`p-disc-${id}`}
            name="discountPercent"
            inputMode="decimal"
            defaultValue={String(period?.discountPercent ?? 0)}
            className={CONTROL_LINE}
          />
        </div>

        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={period?.isDefault ?? false}
            className="size-4"
          />
          {t('fees.isDefault')}
        </label>
      </div>

      <Problem state={state} />
      <Saved state={state} />

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('fees.save')}
        </button>
      </div>
    </form>
  );
}

function PlanForm({
  facilityId,
  plan,
  kind,
  periods,
  levels,
  onDone,
}: {
  facilityId: string;
  plan: FeePlan | null;
  kind: 'mensalidade' | 'quota';
  periods: FeePeriod[];
  levels: StudentLevel[];
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [amount, setAmount] = useState(plan === null ? '' : centsToInput(plan.amountCents));

  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await savePlanAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  // Parsed here so the boundary only ever carries integer cents.
  const cents = parseCents(amount);
  const id = plan?.id ?? `new-${kind}`;

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="kind" value={kind} />
      {plan !== null && <input type="hidden" name="planId" value={plan.id} />}
      <input type="hidden" name="amountCents" value={cents === null ? '' : String(cents)} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kind === 'quota' && (
          <div className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor={`f-band-${id}`} className={FIELD_LABEL}>
              {t('fees.ageBand')}
            </label>
            <select
              id={`f-band-${id}`}
              name="ageBand"
              defaultValue={plan?.ageBand ?? 'any'}
              className={CONTROL_LINE}
            >
              <option value="any">{t('fees.band.any')}</option>
              <option value="under_18">{t('fees.band.under_18')}</option>
              <option value="adult">{t('fees.band.adult')}</option>
            </select>
            {/* Which side of eighteen, read from the member's age today. */}
            <p className="text-sm text-foreground-muted">{t('fees.ageBandHint')}</p>
          </div>
        )}

        {kind === 'mensalidade' && (
          <>
            <div className={cn(FIELD_COLUMN, 'max-w-none')}>
              <label htmlFor={`f-level-${id}`} className={FIELD_LABEL}>
                {t('fees.level')}
              </label>
              <select
                id={`f-level-${id}`}
                name="levelId"
                defaultValue={plan?.levelId ?? ''}
                required
                className={CONTROL_LINE}
              >
                <option value="">{t('fees.chooseLevel')}</option>
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={cn(FIELD_COLUMN, 'max-w-none')}>
              <label htmlFor={`f-lessons-${id}`} className={FIELD_LABEL}>
                {t('fees.lessonsPerWeek')}
              </label>
              <input
                id={`f-lessons-${id}`}
                name="lessonsPerWeek"
                type="number"
                min={1}
                max={7}
                defaultValue={plan?.lessonsPerWeek ?? 1}
                required
                className={CONTROL_LINE}
              />
              {/* The same level can cost two different things — this is what says
                  which. A turma matches its own weekly slot count against it. */}
              <p className="text-sm text-foreground-muted">{t('fees.lessonsHint')}</p>
            </div>
          </>
        )}

        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`f-amount-${id}`} className={FIELD_LABEL}>
            {t('fees.amount')}
          </label>
          <input
            id={`f-amount-${id}`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            className={CONTROL_LINE}
          />
          <p className="text-sm text-foreground-muted">{t('fees.amountHint')}</p>
        </div>

        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`f-period-${id}`} className={FIELD_LABEL}>
            {t('fees.defaultPeriodLabel')}
          </label>
          <select
            id={`f-period-${id}`}
            name="defaultFeePeriodId"
            defaultValue={plan?.defaultFeePeriodId ?? ''}
            className={CONTROL_LINE}
          >
            <option value="">{t('fees.facilityDefault')}</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </div>
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
 * A penalty in words, for anybody who may read the rule but not set it.
 *
 * The same sentence the form composes, so the two cannot drift — and it is
 * visible text, never only a tooltip.
 */
function penaltyInWords(
  t: ReturnType<typeof useTranslations>,
  locale: string,
  kind: FeePenaltyKind,
  cents: number,
  percent: number,
): string {
  if (kind === 'amount') return t('fees.penaltySummary', { amount: formatCents(locale, cents) });
  if (kind === 'percent') return t('fees.penaltyPercentSummary', { percent });
  return t('fees.penaltyNone');
}

/**
 * When a payment is late, and what that costs — round 5.
 *
 * Both on the site, because a club with two pools can genuinely run them
 * differently and because everything else about how a site charges is already
 * here.
 *
 * A mensalidade and a quota are asked separately: a club that fines a late
 * monthly payment often forgives a late subscription, and the two amounts are
 * rarely the same number.
 */
function BillingForm({
  facilityId,
  billing,
}: {
  facilityId: string;
  billing: BillingSettings;
}): React.ReactElement {
  const t = useTranslations();
  const [dueDay, setDueDay] = useState(String(billing.paymentDueDay));
  const [state, submit, pending] = useSavedAction(saveBillingAction, INITIAL);

  const day = Number(dueDay);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <input type="hidden" name="facilityId" value={facilityId} />

      <div className={cn(FIELD_COLUMN, 'max-w-xs')}>
        <label htmlFor="billing-due-day" className={FIELD_LABEL}>
          {t('fees.dueDay')}
        </label>
        <input
          id="billing-due-day"
          name="paymentDueDay"
          type="number"
          min={1}
          max={31}
          value={dueDay}
          onChange={(event) => setDueDay(event.target.value)}
          required
          className={CONTROL_LINE}
        />
        {/*
          The rule this number makes, in words, as it is typed. The label alone
          said "due day" and left the operator to work out what the club had
          actually agreed to.
        */}
        <p className="text-sm">
          {Number.isInteger(day) && day >= 1 && day <= 31
            ? t('fees.dueDaySummary', { day })
            : t('fees.dueDayRange')}
        </p>
        <p className="text-sm text-foreground-muted">{t('fees.dueDayHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PenaltyFields
          idPrefix="late"
          namePrefix="latePenalty"
          label={t('fees.penaltyMensalidadeLabel')}
          hint={t('fees.penaltyMensalidadeHint')}
          kind={billing.latePenaltyKind}
          cents={billing.latePenaltyCents}
          percent={billing.latePenaltyPercent}
        />
        <PenaltyFields
          idPrefix="quota"
          namePrefix="quotaPenalty"
          label={t('fees.penaltyQuotaLabel')}
          hint={t('fees.penaltyQuotaHint')}
          kind={billing.quotaPenaltyKind}
          cents={billing.quotaPenaltyCents}
          percent={billing.quotaPenaltyPercent}
        />
      </div>

      <Problem state={state} />
      <Saved state={state} />

      <button type="submit" disabled={pending} className={cn(BUTTON, 'self-start')}>
        {t('fees.save')}
      </button>
    </form>
  );
}

/**
 * One penalty: whether it is charged, and how.
 *
 * The amount and the percentage are both kept while the other is chosen, so
 * switching between them and back does not make somebody retype a number they
 * already had. Only the chosen one counts — the server reads the kind first.
 */
function PenaltyFields({
  idPrefix,
  namePrefix,
  label,
  hint,
  kind,
  cents,
  percent,
}: {
  idPrefix: string;
  namePrefix: string;
  label: string;
  hint: string;
  kind: FeePenaltyKind;
  cents: number;
  percent: number;
}): React.ReactElement {
  const t = useTranslations();
  const [chosen, setChosen] = useState<FeePenaltyKind>(kind);
  const [amount, setAmount] = useState(centsToInput(cents));
  const [rate, setRate] = useState(percent === 0 ? '' : String(percent).replace('.', ','));

  const parsed = parseCents(amount);

  return (
    <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>

      <input
        type="hidden"
        name={`${namePrefix}Cents`}
        value={parsed === null ? '' : String(parsed)}
      />
      <input type="hidden" name={`${namePrefix}Percent`} value={rate} />

      <div className={cn(FIELD_COLUMN, 'max-w-none')}>
        <label htmlFor={`${idPrefix}-kind`} className={FIELD_LABEL}>
          {t('fees.penaltyKind')}
        </label>
        <select
          id={`${idPrefix}-kind`}
          name={`${namePrefix}Kind`}
          value={chosen}
          onChange={(event) => setChosen(event.target.value as FeePenaltyKind)}
          className={CONTROL_LINE}
        >
          <option value="none">{t('fees.penaltyNone')}</option>
          <option value="amount">{t('fees.penaltyFlat')}</option>
          <option value="percent">{t('fees.penaltyPercent')}</option>
        </select>
      </div>

      {chosen === 'amount' && (
        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`${idPrefix}-amount`} className={FIELD_LABEL}>
            {t('fees.penaltyAmount')}
          </label>
          <input
            id={`${idPrefix}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>
      )}

      {chosen === 'percent' && (
        <div className={cn(FIELD_COLUMN, 'max-w-none')}>
          <label htmlFor={`${idPrefix}-rate`} className={FIELD_LABEL}>
            {t('fees.penaltyRate')}
          </label>
          <input
            id={`${idPrefix}-rate`}
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            className={CONTROL_LINE}
          />
          {/* Of the monthly mensalidade, by decision — the figure a family
              recognises. A member who pays only a quota has none, and the
              penalty is then nothing. */}
          <p className="text-sm text-foreground-muted">{t('fees.penaltyRateHint')}</p>
        </div>
      )}

      <p className="text-sm text-foreground-muted">{hint}</p>
    </fieldset>
  );
}
