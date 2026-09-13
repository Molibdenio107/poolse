'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { RoleBadges } from '@/components/role-badge';
import { Hint } from '@/components/ui/tooltip';
import { formatCents } from '@/lib/money';
import type { SalaryRow } from '@/lib/api';
import { RateSheet } from './rate-sheet';

/**
 * The salary list — POOLSE-58.
 *
 * **A derived figure is muted, marked and explains itself.** The monthly column
 * for an hourly contract, and the hourly column for a monthly one, are computed
 * from the contracted week — so they carry the word *estimativa* and a tooltip
 * saying what the estimate came from. The hours themselves are a **visible
 * column**, not tooltip-only: a tooltip explains what a control does and is never
 * the only place a fact appears, and a number whose basis is available to a
 * mouse alone is a number half the readers cannot check.
 *
 * **A dash is not a zero.** Somebody whose contracted hours are not recorded has
 * no monthly figure at all, and printing €0.00 there would say something false
 * about what they cost.
 */
export function SalaryTable({
  organizationId,
  rows,
  canEdit,
  locale,
}: {
  organizationId: string;
  rows: readonly SalaryRow[];
  canEdit: boolean;
  locale: string;
}): React.ReactElement {
  const t = useTranslations();
  // The named `short` format from `i18n.ts`, never an options object here — a
  // date's shape is defined once for both sides of the boundary.
  const format = useFormatter();
  const [open, setOpen] = useState<SalaryRow | null>(null);

  const money = (cents: number): string => formatCents(locale, cents);

  return (
    <section className="rounded border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="px-4 py-3 font-medium">{t('salaries.field.name')}</th>
              <th scope="col" className="px-4 py-3 font-medium">{t('salaries.field.roles')}</th>
              <th scope="col" className="px-4 py-3 font-medium">{t('salaries.field.kind')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('salaries.field.weeklyHours')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('salaries.field.monthly')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('salaries.field.hourly')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('salaries.field.effectiveFrom')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-foreground-muted">
                  {t('salaries.empty')}
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const live = row.live;

              return (
                <tr key={row.membershipId} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {/*
                      * A button, not a row-level click handler: the history has
                      * to be reachable by keyboard, and a `<tr onClick>` is not.
                      */}
                    <button
                      type="button"
                      onClick={() => setOpen(row)}
                      className="rounded text-left font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {named(row.displayName) ?? t('salaries.unnamed')}
                    </button>
                  </th>
                  <td className="px-4 py-3">
                    <RoleBadges roles={row.roles} />
                  </td>
                  <td className="px-4 py-3">
                    {live === null ? (
                      <span className="text-foreground-muted">{t('salaries.notSet')}</span>
                    ) : (
                      t(`salaries.kind.${live.kind}`)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {live?.weeklyHours == null ? (
                      <Dash label={t('salaries.hoursNotRecorded')} />
                    ) : (
                      t('salaries.hoursValue', { hours: live.weeklyHours })
                    )}
                  </td>
                  <Figure
                    cents={live?.monthlyCents ?? null}
                    derived={live?.monthlyDerived ?? false}
                    money={money}
                  />
                  <Figure
                    cents={live?.hourlyCents ?? null}
                    derived={live?.hourlyDerived ?? false}
                    money={money}
                  />
                  <td className="px-4 py-3 tabular-nums">
                    {live === null ? (
                      <span className="text-foreground-muted">—</span>
                    ) : (
                      format.dateTime(new Date(`${live.effectiveFrom}T00:00:00`), 'short')
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open !== null && (
        <RateSheet
          organizationId={organizationId}
          person={open}
          canEdit={canEdit}
          locale={locale}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/**
 * A name, or nothing.
 *
 * `person_name` composes what it has, so somebody invited and not yet accepted
 * comes back as an empty string rather than null — and an empty string renders
 * as a button with no words in it, which is a control nobody can see or explain.
 */
function named(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value;
}

/** One money cell, muted and labelled when it was derived rather than agreed. */
function Figure({
  cents,
  derived,
  money,
}: {
  cents: number | null;
  derived: boolean;
  money: (cents: number) => string;
}): React.ReactElement {
  const t = useTranslations();

  if (cents === null) {
    return (
      <td className="px-4 py-3 text-right">
        <Dash label={t('salaries.hoursNotRecorded')} />
      </td>
    );
  }

  if (!derived) {
    return <td className="px-4 py-3 text-right tabular-nums">{money(cents)}</td>;
  }

  return (
    <td className="px-4 py-3 text-right tabular-nums text-foreground-muted">
      <Hint text={t('salaries.derivedExplains')}>
        <span className="underline decoration-dotted underline-offset-4">{money(cents)}</span>
      </Hint>{' '}
      <span className="text-xs">{t('salaries.estimate')}</span>
    </td>
  );
}

/**
 * A dash with a name.
 *
 * The mark is what a reader sees; the label is what a screen reader says, so
 * "not recorded" is never conveyed by a hyphen alone.
 */
function Dash({ label }: { label: string }): React.ReactElement {
  return (
    <>
      <span aria-hidden className="text-foreground-muted">—</span>
      <span className="sr-only">{label}</span>
    </>
  );
}
