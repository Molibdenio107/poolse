'use client';

import { today } from '@/lib/dates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Pencil, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { Closure, Closures, MessagePreview, PartOfDay } from '@/lib/api';
import { YearGrid, type DayState } from '@/components/year-grid';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../../actions';
import {
  createClosureAction,
  impactAction,
  previewClosureWarning,
  removeClosureAction,
  sendClosureWarning,
  updateClosureAction,
  type ClosureState,
} from './closures.actions';
import { formatDate } from '@/lib/date-format';
import { FromLink } from '@/components/from-link';

/**
 * Encerramentos as a year — POOLSE-31.
 *
 * The same twelve-month grid as Férias, and deliberately so: an operator who has
 * learned one calendar in this product should not have to learn a second. What
 * differs is what a day means — leave belongs to a person, a closure belongs to
 * the building.
 *
 * **Ranges are picked the way people pick dates.** Click the first day, move,
 * click the last. The days between paint as you move, so the range you are about
 * to create is the range you can see. A pair of date fields would be fewer
 * moving parts and would also mean typing "2027-03-14" to say "that Saturday".
 *
 * **Feriados are shown, not hidden.** Greyed, named, and not selectable: the
 * pool is already closed, and a closure over the top of one would be a second
 * reason for the same day. They stay keyboard-reachable, because a day whose
 * name only a mouse can reach is a day half the staff cannot read.
 *
 * **What a closure costs is said before it is made.** If the range covers
 * classes whose register has already been taken, the confirmation says how many.
 * Cancelling a class nobody marked is routine; cancelling one somebody stood at
 * the poolside and wrote down is not.
 */

const INITIAL: FormState = { ok: false };
const INITIAL_CLOSURE: ClosureState = { ok: false };

/** Inclusive, and tolerant of the two clicks arriving in either order. */
function rangeOf(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function within(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

/**
 * The days a closure covers inside one year. A repeating one is a pattern
 * projected onto the year — and one that runs past 31 December (24-12 to
 * 02-01) is two ranges, the start of January and the end of December; read as
 * one, its start fell after its end and it was never drawn (19-10-2026 sweep).
 */
function yearRanges(closure: Closure, year: number): [string, string][] {
  if (!closure.repeatsAnnually) return [[closure.startsOn, closure.endsOn]];
  const from = `${year}-${closure.startsOn.slice(5)}`;
  const to = `${year}-${closure.endsOn.slice(5)}`;
  return from <= to ? [[from, to]] : [[`${year}-01-01`, to], [from, `${year}-12-31`]];
}

/** A site and its tanks — what the form scopes a closure by (POOLSE-84). */
type Site = Closures['sites'][number];

/** "Sede · Tanque 2 · manhã" — where and when a closure bites, as visible text. */
function useScopeLabel(): (closure: Closure) => string {
  const t = useTranslations();
  return (closure) =>
    [
      closure.facilityName ?? t('calendar.everySite'),
      closure.poolName ?? t('calendar.wholeSite'),
      closure.partOfDay === null ? null : t(`calendar.partOfDay.${closure.partOfDay}`),
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');
}

export function ClosureCalendar({
  organizationId,
  year,
  closures,
  sites,
  halfDayCut,
  canManage,
  prefill = null,
  messagesOn = true,
}: {
  /** POOLSE-87 sweep: the families are warned through messages; off, no offer. */
  messagesOn?: boolean;
  organizationId: string;
  year: number;
  closures: Closure[];
  /** Each site with its tanks — the form's scope (POOLSE-84). */
  sites: Site[];
  /** Where a morning ends, from the database. */
  halfDayCut: string;
  canManage: boolean;
  /**
   * A reason and a pool the operator has effectively already chosen — round 6.
   *
   * Set when they arrived from a pool whose water is out of range. It seeds the
   * form once days are picked; it never picks the days, because which days to
   * shut is the one part of this that only the operator knows.
   */
  prefill?: { poolId: string; reason: string } | null;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const scopeOf = useScopeLabel();

  // Built here rather than passed in, exactly as Férias builds them: the month
  // and weekday names belong to the reader's locale, and the grid is the only
  // thing that needs them.
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(year, index, 1)),
        ),
      ),
    [locale, year],
  );

  const weekdayInitials = useMemo(
    () =>
      // 2024-01-01 was a Monday, so this walks Monday → Sunday in the reader's
      // own language rather than hard-coding "S T Q Q S S D".
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2024, 0, 1 + index)),
        ),
      ),
    [locale],
  );

  // The one date shape, spoken as well as shown — CLAUDE.md's dd-MM-yyyy rule.
  const labelFor = (day: string): string => formatDate(day);

  const [anchor, setAnchor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, setPending] = useState<[string, string] | null>(null);

  /**
   * Day → the closure covering it.
   *
   * Built once per render rather than scanning every closure for each of 365
   * days. A club with twenty closures and a year of cells is 7 300 comparisons
   * otherwise, on every hover.
   */
  const byDay = useMemo(() => {
    const map = new Map<string, Closure[]>();
    for (const closure of closures) {
      // A repeating closure is a pattern; this grid shows one year, so it is
      // projected onto that year rather than onto the dates it was created with.
      for (const [from, to] of yearRanges(closure, year)) {
        for (
          let day = new Date(`${from}T00:00:00Z`);
          day <= new Date(`${to}T00:00:00Z`);
          day.setUTCDate(day.getUTCDate() + 1)
        ) {
          const iso = day.toISOString().slice(0, 10);
          if (iso.startsWith(String(year))) map.set(iso, [...(map.get(iso) ?? []), closure]);
        }
      }
    }
    return map;
  }, [closures, year]);

  // The range being drawn: anchored on the first click, ending wherever the
  // cursor or focus currently is.
  const preview = anchor !== null && hovered !== null ? rangeOf(anchor, hovered) : null;

  const stateFor = (day: string): DayState => {
    /*
      The chosen range stays lit while the form is open — round 4 follow-up.

      Before, the second click cleared `anchor`, which cleared the preview, so
      the days you had just picked went back to looking like every other day and
      the form below asked for a reason for a range you could no longer see.
      Checked before the closure and preview branches because it is the most
      specific thing that can be true of a day: it is the one you are acting on.
    */
    if (pending !== null && within(day, pending[0], pending[1])) {
      return {
        className: 'bg-primary/40 ring-2 ring-inset ring-primary',
        description: t('calendar.legendSelecting'),
      };
    }

    const onDay = byDay.get(day);
    const closure = onDay?.[0];

    if (closure !== undefined && onDay !== undefined) {
      // A holiday shuts everything; otherwise the day is held by a person's
      // closures, each named with where it bites — POOLSE-84.
      const holiday = onDay.some((one) => one.source !== 'manual');
      const named = holiday
        ? closure.reason
        : onDay.map((one) => `${one.reason} (${scopeOf(one)})`).join('; ');
      return {
        // Feriados read as absence of a working day; a closure reads as a
        // decision somebody made. Different colours because they are different
        // facts, and both carry their name.
        className: holiday ? 'bg-surface-muted text-foreground-muted' : 'bg-warning/25',
        description: named,
        title: named,
        disabled: holiday,
        focusable: holiday,
        // A dot marks a closure somebody made, so the two kinds differ by more
        // than hue. Absent on a feriado rather than set to undefined — see
        // exactOptionalPropertyTypes.
        ...(holiday ? {} : { marker: '•' }),
      };
    }

    if (preview !== null && within(day, preview[0], preview[1])) {
      return { className: 'bg-primary/30', description: t('calendar.rangeEnd') };
    }

    return {};
  };

  const pick = (day: string): void => {
    if (!canManage) return;

    /*
      A click anywhere on the grid abandons the range — round 4 follow-up.

      The way out of a half-finished closure used to be finding the "clear"
      button in the strip above; clicking another day did nothing at all, which
      is the first thing anybody tries. Now the grid is the escape hatch: one
      click puts the calendar back to neutral and takes the reason card with it.
      The second click then starts a fresh range, which is one more click than
      strictly necessary and much easier to explain than a click that both
      cancels and re-anchors.
    */
    if (pending !== null) {
      setPending(null);
      setAnchor(null);
      setHovered(null);
      return;
    }

    if (anchor === null) {
      setAnchor(day);
      setHovered(day);
      return;
    }

    // Second click closes the range and opens the form. The name is asked for
    // there rather than here, because a closure without a reason is a mystery
    // in six months.
    setPending(rangeOf(anchor, day));
    setAnchor(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/*
        The same strip Férias puts above its grid: a bordered surface panel
        holding the state of the selection and the way out of it. Same shell,
        different verbs — that page counts chosen days and submits a request,
        this one is drawing a range.
      */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface p-4">
        <span className="text-sm">
          {anchor === null
            ? t('calendar.rangeStartHint')
            : t('calendar.rangeAnchored', { day: formatDate(anchor) })}
        </span>

        {anchor !== null && (
          <button
            type="button"
            onClick={() => {
              setAnchor(null);
              setHovered(null);
            }}
            className="rounded text-sm text-foreground-muted hover:text-foreground"
          >
            {t('calendar.clearRange')}
          </button>
        )}

        <Legend />
      </div>

      <p className="text-sm text-foreground-muted">
        {pending !== null
          ? t('calendar.rangeHeldHint')
          : anchor === null
            ? t('calendar.gridHint')
            : t('calendar.rangeEndHint')}
      </p>

      <YearGrid
        year={year}
        monthNames={monthNames}
        weekdayInitials={weekdayInitials}
        stateFor={stateFor}
        // Still pickable while a range is held: that click is what clears it.
        onPick={canManage ? pick : undefined}
        onHover={setHovered}
        labelFor={labelFor}
        // A closure cannot be declared for a week that has already happened.
        pastBefore={today()}
      />

      {pending !== null && (
        <ClosureForm
          organizationId={organizationId}
          range={pending}
          sites={sites}
          halfDayCut={halfDayCut}
          prefill={prefill}
          onDone={() => setPending(null)}
          messagesOn={messagesOn}
        />
      )}

      <ClosureList
        closures={closures}
        canManage={canManage}
        organizationId={organizationId}
        sites={sites}
        halfDayCut={halfDayCut}
      />
    </div>
  );
}

/**
 * What the colours mean — criterion 2, and the rule from CLAUDE.md.
 *
 * Every band on this calendar is also a row in the list below, so the colour is
 * a way of finding something rather than the only way of knowing it. The legend
 * is what makes the grid readable at a glance without that trip.
 */
function Legend(): React.ReactElement {
  const t = useTranslations();

  const items = [
    { className: 'bg-surface-muted border border-border', label: t('calendar.legendHoliday') },
    { className: 'bg-warning/25', label: t('calendar.legendClosure') },
    { className: 'bg-primary/30', label: t('calendar.legendSelecting') },
  ];

  return (
    <ul className="ml-auto flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden className={`size-3 shrink-0 rounded ${item.className}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Naming the range, saying what it will cost, and — if asked — telling the
 * families. A dialog since 12 October 2026 (Rui): the card under the year grid
 * sat below the fold of a twelve-month calendar, so the range was drawn in one
 * place and named somewhere you had to scroll to.
 *
 * **Two steps when the families are warned.** The closure is saved first: it
 * is what cancels the lessons, and the warning is addressed to exactly the
 * turmas it cancelled (the `closure` message audience). Then the dialog asks
 * the server who that reaches and sends only on a second, explicit press — the
 * same count-then-confirm the Mensagens composer uses, through the same
 * endpoint, so it lands in Mensagens as a record of who was told.
 *
 * The impact is fetched when the dialog opens rather than as the range is
 * drawn: one request per confirmed range instead of one per day hovered.
 */
function ClosureForm({
  organizationId,
  range,
  sites,
  halfDayCut,
  prefill,
  onDone,
  messagesOn,
}: {
  messagesOn: boolean;
  organizationId: string;
  range: [string, string];
  sites: Site[];
  halfDayCut: string;
  /** Seeded from a pool's water warning, when that is where this came from. */
  prefill: { poolId: string; reason: string } | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const { show } = useToast();
  const [state, action, saving] = useSavedAction(createClosureAction, INITIAL_CLOSURE);
  /*
   * Loading, failed or answered — three states, not one null for two —
   * October 2026 sweep. A check that failed rendered exactly like one still
   * running, and an operator closed a week over registers already taken
   * believing nothing was affected. The form stays submittable either way.
   */
  const [impact, setImpact] = useState<
    'loading' | 'failed' | { sessions: number; marked: number }
  >('loading');

  /*
   * The scope — POOLSE-84. Always one site; no tank ticked means all of it, and
   * each tank ticked becomes its own closure. A water warning arrives naming a
   * tank, so it picks that tank's site and ticks it.
   */
  const prefillSite =
    prefill === null
      ? undefined
      : sites.find((site) => site.pools.some((pool) => pool.id === prefill.poolId))?.id;
  const [facilityId, setFacilityId] = useState(prefillSite ?? sites[0]?.id ?? '');
  const [poolIds, setPoolIds] = useState<string[]>(
    prefill !== null && prefillSite !== undefined ? [prefill.poolId] : [],
  );
  const site = sites.find((one) => one.id === facilityId);

  // Half a day only on one day — the API and a CHECK say so too.
  const oneDay = range[0] === range[1];
  const [halfDay, setHalfDay] = useState(false);
  const [part, setPart] = useState<PartOfDay>('morning');
  const partOfDay: PartOfDay | null = oneDay && halfDay ? part : null;

  // Controlled, like every field here — an uncontrolled select reverts after
  // the action returns (POOLSE-09/10).
  const [reason, setReason] = useState(prefill?.reason ?? '');
  const [warn, setWarn] = useState(false);
  const from = formatDate(range[0]);
  const to = formatDate(range[1]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // The second step: who the warning reaches, then the send.
  const [warning, setWarning] = useState<
    | { step: 'counting'; closureId: string }
    | { step: 'failed'; closureId: string }
    | { step: 'confirm'; closureId: string; preview: MessagePreview }
    | null
  >(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{
    key: string;
    values?: Record<string, number>;
  } | null>(null);

  // Asked again whenever the scope changes: two tanks cost more than one.
  useEffect(() => {
    let live = true;
    setImpact('loading');
    if (facilityId === '') return;
    void impactAction(organizationId, {
      startsOn: range[0],
      endsOn: range[1],
      facilityId,
      poolIds,
      partOfDay,
    })
      .then((answer) => live && setImpact(answer ?? 'failed'))
      .catch(() => live && setImpact('failed'));
    return () => {
      live = false;
    };
  }, [organizationId, range[0], range[1], facilityId, poolIds, partOfDay]);

  /*
   * Written when the box is ticked, from the closure as it stands then — where
   * (the site, or the tanks by name) and when (a range, one day, or a half) —
   * and then the operator's own to change, never rewritten under them. It used
   * to say "a piscina estará encerrada de X a X" whatever was closed, so the
   * families of the open tanks, or of the afternoon, read that they had no class
   * (19-10-2026 sweep).
   */
  function toggleWarn(on: boolean): void {
    setWarn(on);
    if (!on) return;
    const names = (site?.pools ?? [])
      .filter((pool) => poolIds.includes(pool.id))
      .map((pool) => pool.name)
      .join(', ');
    const where =
      poolIds.length === 0
        ? t('calendar.warn.whereSite', { site: site?.name ?? '' })
        : t('calendar.warn.whereTanks', { count: poolIds.length, names });
    const when =
      range[0] !== range[1]
        ? t('calendar.warn.whenRange', { from, to })
        : partOfDay === null
          ? t('calendar.warn.whenDay', { day: from })
          : t(`calendar.warn.when.${partOfDay}`, { day: from });
    if (subject === '') setSubject(t('calendar.warn.subjectDefault', { when }));
    if (body === '') {
      setBody(t('calendar.warn.bodyDefault', { when, where, reason: reason.trim() }));
    }
  }

  function toggleTank(poolId: string, on: boolean): void {
    setPoolIds((current) =>
      on ? [...current, poolId] : current.filter((id) => id !== poolId),
    );
  }

  // After the render, not during it: closing this form updates the parent.
  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (!state.ok) return;
    if (!warn || state.closureId === undefined) {
      onDone();
      return;
    }
    const closureId = state.closureId;
    setWarning({ step: 'counting', closureId });
    void previewClosureWarning(organizationId, closureId).then((preview) =>
      setWarning(
        preview === null
          ? { step: 'failed', closureId }
          : { step: 'confirm', closureId, preview },
      ),
    );
  }, [state, onDone, warn, organizationId]);

  async function send(closureId: string): Promise<void> {
    setSending(true);
    setSendError(null);
    const result = await sendClosureWarning(organizationId, closureId, subject, body);
    setSending(false);
    if (!result.ok) {
      setSendError({
        key: result.errorKey,
        ...(result.values === undefined ? {} : { values: result.values }),
      });
      return;
    }
    show('success', t('calendar.warn.sent'));
    onDone();
  }

  const BUTTON =
    'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60';
  const BUTTON_QUIET =
    'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border';
  const sendable = warning?.step === 'confirm' && warning.preview.addressCount > 0;
  const reached =
    warning?.step === 'confirm'
      ? warning.preview.studentCount + warning.preview.partnerCount + warning.preview.leadCount
      : 0;

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('calendar.closeFrom', { from, to })}
      closeLabel={t('common.cancel')}
    >
      {sites.length === 0 ? (
        <p className="text-sm">
          {t('calendar.noSites')}{' '}
          <FromLink href="/dashboard/facilities" className="text-primary underline underline-offset-2">
            {t('calendar.noSitesLink')}
          </FromLink>
        </p>
      ) : warning === null ? (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="startsOn" value={range[0]} />
          <input type="hidden" name="endsOn" value={range[1]} />
          <input type="hidden" name="facilityId" value={facilityId} />
          {poolIds.map((id) => (
            <input key={id} type="hidden" name="poolIds" value={id} />
          ))}
          <input type="hidden" name="partOfDay" value={partOfDay ?? ''} />

          {/*
            Criterion 10. A register already taken means somebody stood at the
            poolside and wrote it down; they are told before the closure is made,
            not after.
          */}
          {impact === 'failed' && (
            <p className="text-sm text-warning">{t('calendar.impactUnknown')}</p>
          )}
          {typeof impact === 'object' && impact.marked > 0 && (
            <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {t('calendar.impactMarked', { marked: impact.marked, sessions: impact.sessions })}
            </p>
          )}
          {typeof impact === 'object' && impact.marked === 0 && impact.sessions > 0 && (
            <p className="text-sm text-foreground-muted">
              {t('calendar.impactSessions', { count: impact.sessions })}
            </p>
          )}

          {/*
            Seeded, not fixed. An operator arriving from a water warning gets the
            sentence about the failed reading already written, and can rewrite
            every word of it — they are the one who knows why the pool is shut.
          */}
          <TextField
            name="reason"
            label={t('calendar.closureReason')}
            placeholder={t('calendar.closureReasonPlaceholder')}
            initial={reason}
            onValueChange={setReason}
            required
            maxLength={200}
            error={state.fields?.['reason'] === undefined ? undefined : t(state.fields['reason'])}
            className="max-w-none"
          />

          {/* One site, always. A club with one says which, rather than asking. */}
          {sites.length > 1 ? (
            <SelectField
              name="siteChoice"
              label={t('calendar.closureSite')}
              initial={facilityId}
              onValueChange={(value) => {
                setFacilityId(value);
                setPoolIds([]);
              }}
              options={sites.map((one) => ({ value: one.id, label: one.name }))}
              className="max-w-none"
            />
          ) : (
            site !== undefined && (
              <p className="text-sm">
                <span className="font-medium">{t('calendar.closureSite')}:</span> {site.name}
              </p>
            )
          )}

          {site !== undefined && site.pools.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('calendar.closureScope')}</legend>
              <p className="text-sm text-foreground-muted">
                {poolIds.length === 0
                  ? t('calendar.scopeWholeSite', { site: site.name })
                  : t('calendar.scopeTanks', { count: poolIds.length })}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {site.pools.map((pool) => (
                  <label key={pool.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={poolIds.includes(pool.id)}
                      onChange={(event) => toggleTank(pool.id, event.target.checked)}
                      className="size-4"
                    />
                    {pool.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {oneDay && (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={halfDay}
                  onChange={(event) => setHalfDay(event.target.checked)}
                  className="size-4"
                />
                <span className="font-medium">{t('calendar.halfDay')}</span>
              </label>
              {halfDay && (
                <SelectField
                  name="partChoice"
                  label={t('calendar.halfDayWhich')}
                  initial={part}
                  onValueChange={(value) => setPart(value === 'afternoon' ? 'afternoon' : 'morning')}
                  options={[
                    { value: 'morning', label: t('calendar.partOfDay.morning') },
                    { value: 'afternoon', label: t('calendar.partOfDay.afternoon') },
                  ]}
                  hint={t('calendar.halfDayHint', { cut: halfDayCut })}
                  className="max-w-none"
                />
              )}
            </div>
          )}

          <p className="text-sm text-foreground-muted">{t('calendar.closureEffect')}</p>

          {messagesOn && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={warn}
              onChange={(event) => toggleWarn(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">{t('calendar.warn.label')}</span>
              <span className="block text-foreground-muted">{t('calendar.warn.hint')}</span>
            </span>
          </label>
          )}

          {warn && (
            <div className="flex flex-col gap-3 rounded border border-border p-3">
              <TextField
                name="warnSubject"
                label={t('calendar.warn.subject')}
                initial={subject}
                onValueChange={setSubject}
                maxLength={200}
                className="max-w-none"
              />
              <TextAreaField
                name="warnBody"
                label={t('calendar.warn.body')}
                initial={body}
                onValueChange={setBody}
                rows={5}
                maxLength={10000}
                className="max-w-none"
              />
            </div>
          )}

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">
              {t(state.errorKey, { existing: state.detail ?? '', ...(state.values ?? {}) })}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={
                saving ||
                facilityId === '' ||
                (warn && (subject.trim() === '' || body.trim() === ''))
              }
              className={BUTTON}
            >
              {saving
                ? t('common.working')
                : warn
                  ? t('calendar.warn.saveAndCount')
                  : t('calendar.addClosure')}
            </button>
            <button type="button" onClick={onDone} className={BUTTON_QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-success">{t('calendar.warn.closureSaved')}</p>

          {warning.step === 'counting' && (
            <p className="text-sm text-foreground-muted">{t('calendar.warn.counting')}</p>
          )}
          {warning.step === 'failed' && (
            <p className="text-sm text-danger">{t('calendar.warn.countFailed')}</p>
          )}
          {warning.step === 'confirm' && reached === 0 && (
            <p className="text-sm">{t('calendar.warn.nobody')}</p>
          )}
          {warning.step === 'confirm' && reached > 0 && (
            <>
              <p className="text-sm">
                {t('calendar.warn.reaches', { addresses: warning.preview.addressCount })}
              </p>
              <ul className="list-disc pl-5 text-sm">
                {warning.preview.studentCount > 0 && (
                  <li>{t('calendar.warn.students', { count: warning.preview.studentCount })}</li>
                )}
                {warning.preview.partnerCount > 0 && (
                  <li>{t('calendar.warn.partners', { count: warning.preview.partnerCount })}</li>
                )}
                {warning.preview.leadCount > 0 && (
                  <li>{t('calendar.warn.leads', { count: warning.preview.leadCount })}</li>
                )}
              </ul>
              {warning.preview.unreachable.length > 0 && (
                <p className="text-sm text-warning">
                  {t('calendar.warn.unreachable', {
                    count: warning.preview.unreachable.length,
                    names: warning.preview.unreachable.map((one) => one.name).join(', '),
                  })}
                </p>
              )}
              {!warning.preview.emailConfigured && (
                <p className="text-sm text-foreground-muted">{t('calendar.warn.notSent')}</p>
              )}
            </>
          )}

          {sendError !== null && (
            <p className="text-sm text-danger">{t(sendError.key, sendError.values ?? {})}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {sendable && (
              <button
                type="button"
                disabled={sending}
                onClick={() => void send(warning.closureId)}
                className={BUTTON}
              >
                {sending ? t('common.working') : t('calendar.warn.send')}
              </button>
            )}
            <button type="button" onClick={onDone} className={BUTTON_QUIET}>
              {sendable ? t('calendar.warn.dontSend') : t('common.close')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * The closures this club decided on — not the feriados.
 *
 * Round 4: the national holidays were dropped from this list. They are the same
 * thirteen days every year, Poolse put them there rather than the operator, and
 * repeating them under the grid pushed the two or three closures somebody
 * actually has to manage off the bottom of the screen. What is left is the list
 * of things there is something to do about, each with its remove button.
 *
 * The feriados keep their own colour on the grid and their name in each day's
 * accessible label, so nothing has vanished — but their name is no longer
 * visible text anywhere on the page, which is a real trade against this repo's
 * rule that a tooltip must never be the only place information appears. It is
 * the operator's call and it is recorded here so the next reader knows it was
 * a decision. If it turns out to bite, the fix is a compact "Feriados" summary
 * beside the legend rather than putting all thirteen rows back.
 */
function ClosureList({
  closures,
  canManage,
  organizationId,
  sites,
  halfDayCut,
}: {
  closures: Closure[];
  canManage: boolean;
  organizationId: string;
  sites: Site[];
  halfDayCut: string;
}): React.ReactElement {
  const t = useTranslations();
  const scopeOf = useScopeLabel();

  const managed = closures.filter((closure) => closure.source === 'manual');

  if (managed.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('calendar.noClosures')}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
      {managed.map((closure) => (
        <li
          key={closure.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3"
        >
          {/*
            One swatch and no badge: every row here is a manual closure now, so
            the branch that distinguished them from feriados would be dead code
            pretending the list still holds both.
          */}
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="size-3 shrink-0 rounded bg-warning/25" />
            <span className="font-medium">{closure.reason}</span>
            {/* Where it bites — one row per tank, so each reopens on its own. */}
            <span className="text-sm text-foreground-muted">{scopeOf(closure)}</span>
          </span>

          <span className="flex items-center gap-3 text-sm text-foreground-muted">
            {closure.startsOn === closure.endsOn
              ? formatDate(closure.startsOn)
              : `${formatDate(closure.startsOn)} — ${formatDate(closure.endsOn)}`}
            {canManage && (
              <EditClosure
                organizationId={organizationId}
                closure={closure}
                sites={sites}
                halfDayCut={halfDayCut}
              />
            )}
            {canManage && (
              <RemoveClosure
                organizationId={organizationId}
                closureId={closure.id}
                reason={closure.reason}
              />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Change one closure — POOLSE-84's follow-up.
 *
 * The days are typed here rather than drawn on the year: the range already
 * exists, and shortening it by two days is two keystrokes, where redrawing it
 * would be starting again. One closure is one tank (or the whole site), so the
 * scope is a single choice, not the create form's tick boxes. The cost shown is
 * what the change would *add*: lessons this closure already took are counted as
 * taken, not again.
 */
function EditClosure({
  organizationId,
  closure,
  sites,
  halfDayCut,
}: {
  organizationId: string;
  closure: Closure;
  sites: Site[];
  halfDayCut: string;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('calendar.editClosure', { reason: closure.reason })}
        className="rounded p-1 text-foreground-muted hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Pencil className="size-4" aria-hidden />
      </button>
      {open && (
        <EditClosureDialog
          organizationId={organizationId}
          closure={closure}
          sites={sites}
          halfDayCut={halfDayCut}
          onDone={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EditClosureDialog({
  organizationId,
  closure,
  sites,
  halfDayCut,
  onDone,
}: {
  organizationId: string;
  closure: Closure;
  sites: Site[];
  halfDayCut: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, saving] = useSavedAction(updateClosureAction, INITIAL_CLOSURE);

  const [reason, setReason] = useState(closure.reason);
  const [startsOn, setStartsOn] = useState(closure.startsOn);
  const [endsOn, setEndsOn] = useState(closure.endsOn);
  const [facilityId, setFacilityId] = useState(closure.facilityId ?? sites[0]?.id ?? '');
  const [poolId, setPoolId] = useState(closure.poolId ?? '');
  const [halfDay, setHalfDay] = useState(closure.partOfDay !== null);
  const [part, setPart] = useState<PartOfDay>(closure.partOfDay ?? 'morning');
  const site = sites.find((one) => one.id === facilityId);
  const oneDay = startsOn !== '' && startsOn === endsOn;
  const partOfDay: PartOfDay | null = oneDay && halfDay ? part : null;

  const [impact, setImpact] = useState<
    'loading' | 'failed' | { sessions: number; marked: number }
  >('loading');
  useEffect(() => {
    let live = true;
    setImpact('loading');
    if (facilityId === '' || startsOn === '' || endsOn === '' || endsOn < startsOn) return;
    void impactAction(organizationId, {
      startsOn,
      endsOn,
      facilityId,
      poolIds: poolId === '' ? [] : [poolId],
      partOfDay,
      repeatsAnnually: closure.repeatsAnnually,
    })
      .then((answer) => live && setImpact(answer ?? 'failed'))
      .catch(() => live && setImpact('failed'));
    return () => {
      live = false;
    };
  }, [organizationId, startsOn, endsOn, facilityId, poolId, partOfDay, closure.repeatsAnnually]);

  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.ok) onDone();
  }, [state, onDone]);

  const BUTTON =
    'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60';
  const BUTTON_QUIET =
    'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border';

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('calendar.editClosureTitle', { reason: closure.reason })}
      closeLabel={t('common.cancel')}
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="closureId" value={closure.id} />
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="poolId" value={poolId} />
        <input type="hidden" name="partOfDay" value={partOfDay ?? ''} />

        <TextField
          name="reason"
          label={t('calendar.closureReason')}
          initial={reason}
          onValueChange={setReason}
          required
          maxLength={200}
          error={state.fields?.['reason'] === undefined ? undefined : t(state.fields['reason'])}
          className="max-w-none"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            name="startsOn"
            type="date"
            label={t('calendar.closureFrom')}
            initial={startsOn}
            onValueChange={setStartsOn}
            required
            error={state.fields?.['startsOn'] === undefined ? undefined : t(state.fields['startsOn'])}
          />
          <TextField
            name="endsOn"
            type="date"
            label={t('calendar.closureTo')}
            initial={endsOn}
            onValueChange={setEndsOn}
            required
            error={state.fields?.['endsOn'] === undefined ? undefined : t(state.fields['endsOn'])}
          />
        </div>

        {sites.length > 1 && (
          <SelectField
            name="siteChoice"
            label={t('calendar.closureSite')}
            initial={facilityId}
            onValueChange={(value) => {
              setFacilityId(value);
              setPoolId('');
            }}
            options={sites.map((one) => ({ value: one.id, label: one.name }))}
            className="max-w-none"
          />
        )}

        {site !== undefined && site.pools.length > 0 && (
          <SelectField
            name="poolChoice"
            label={t('calendar.closureScope')}
            initial={poolId}
            onValueChange={setPoolId}
            options={[
              { value: '', label: t('calendar.wholeSiteNamed', { site: site.name }) },
              ...site.pools.map((pool) => ({ value: pool.id, label: pool.name })),
            ]}
            hint={t('calendar.editOneTank')}
            className="max-w-none"
          />
        )}

        {oneDay && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={halfDay}
                onChange={(event) => setHalfDay(event.target.checked)}
                className="size-4"
              />
              <span className="font-medium">{t('calendar.halfDay')}</span>
            </label>
            {halfDay && (
              <SelectField
                name="partChoice"
                label={t('calendar.halfDayWhich')}
                initial={part}
                onValueChange={(value) => setPart(value === 'afternoon' ? 'afternoon' : 'morning')}
                options={[
                  { value: 'morning', label: t('calendar.partOfDay.morning') },
                  { value: 'afternoon', label: t('calendar.partOfDay.afternoon') },
                ]}
                hint={t('calendar.halfDayHint', { cut: halfDayCut })}
                className="max-w-none"
              />
            )}
          </div>
        )}

        {impact === 'failed' && <p className="text-sm text-warning">{t('calendar.impactUnknown')}</p>}
        {typeof impact === 'object' && impact.marked > 0 && (
          <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {t('calendar.impactMarked', { marked: impact.marked, sessions: impact.sessions })}
          </p>
        )}
        {typeof impact === 'object' && impact.marked === 0 && impact.sessions > 0 && (
          <p className="text-sm text-foreground-muted">
            {t('calendar.editImpact', { count: impact.sessions })}
          </p>
        )}
        <p className="text-sm text-foreground-muted">{t('calendar.editGivesBack')}</p>

        {state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey, state.values ?? {})}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving || facilityId === ''} className={BUTTON}>
            {saving ? t('common.working') : t('common.save')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RemoveClosure({
  organizationId,
  closureId,
  reason,
}: {
  organizationId: string;
  closureId: string;
  reason: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeClosureAction, INITIAL);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="closureId" value={closureId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('calendar.removeClosure', { reason })}
        className="rounded p-1 text-foreground-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      >
        <X className="size-4" aria-hidden />
      </button>
    </form>
  );
}
