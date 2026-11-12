'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import type { TimetableHoursNeeded, TimetableRow } from './import.actions';

/**
 * What stands between a timetable and the calendar, by cause — Rui, 11-11-2026:
 * "I don't need to make the user scroll forever to solve conflicts".
 *
 * One line per cause with its count and one action, the rows folded beneath:
 *
 * - **unreadable** (a time that is not a time, a lane that is not there): *Não importar*;
 * - **outside the site's hours** or on a closed day: *Alargar o horário* (one click,
 *   asks first) or *Não importar*;
 * - **the file against itself** (same lane, same hour): *Manter a primeira de cada*;
 * - **against what is already on the calendar**: *Não importar*. Never overwritten
 *   (POOLSE-57, decision 2);
 * - anything else, by its rule.
 *
 * Information that holds nothing back (lanes placed for "3 pistas", rows going to
 * *Sem pista*, an unknown teacher) is a quiet summary, also by cause.
 */

type Group = {
  key: string;
  /** The sentence, already translated. */
  title: string;
  rows: TimetableRow[];
  kind: 'problem' | 'hours' | 'file' | 'grid' | 'rule';
};

const HOURS_CODES = new Set(['outsideHours', 'weekdayDisabled']);

function blocking(row: TimetableRow): TimetableRow['clashes'] {
  return row.clashes.filter((clash) => clash.verdict === 'block' || HOURS_CODES.has(clash.code));
}

export function ConflictGroups({
  rows,
  dropped,
  hoursNeeded,
  working,
  onDrop,
  onKeep,
  onExtendHours,
  onImportClean,
}: {
  rows: TimetableRow[];
  dropped: number[];
  hoursNeeded: TimetableHoursNeeded[];
  working: boolean;
  /** Leave these rows out and check again. */
  onDrop: (indexes: number[]) => void;
  /** Bring these rows back and check again. */
  onKeep: (indexes: number[]) => void;
  /** Widen the site's hours to what the file needs, then check again. */
  onExtendHours: () => void;
  /** Leave every row with a conflict out, and import the rest — one click. */
  onImportClean: (indexes: number[]) => void;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState<string | null>(null);
  const [askHours, setAskHours] = useState(false);

  const clock = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  // Who holds the import back, grouped by why.
  const held = rows.filter((row) => !row.importable && !dropped.includes(row.index));
  const groups = new Map<string, Group>();
  const add = (key: string, kind: Group['kind'], title: () => string, row: TimetableRow): void => {
    const group = groups.get(key) ?? { key, kind, title: '', rows: [] };
    group.rows.push(row);
    group.title = title();
    groups.set(key, group);
  };
  for (const row of held) {
    const problem = row.problems[0];
    const blocks = blocking(row);
    if (problem !== undefined) {
      add(`problem:${problem.code}`, 'problem', () => t(`timetableImport.groups.problem.${problem.code}`), row);
    } else if (blocks.some((clash) => HOURS_CODES.has(clash.code))) {
      add('hours', 'hours', () => '', row);
    } else if (blocks.some((clash) => clash.withLine !== null)) {
      add('file', 'file', () => '', row);
    } else if (blocks.some((clash) => clash.with !== null)) {
      add('grid', 'grid', () => '', row);
    } else {
      const code = blocks[0]?.code ?? 'unknown';
      add(`rule:${code}`, 'rule', () => t(`timetableImport.groups.rule`, { reason: t(`timetableImport.groups.reason.${code in REASONS ? code : 'other'}`) }), row);
    }
  }
  for (const group of groups.values()) {
    if (group.kind === 'hours') group.title = t('timetableImport.groups.hours', { count: group.rows.length });
    if (group.kind === 'file') group.title = t('timetableImport.groups.file', { count: group.rows.length });
    if (group.kind === 'grid') group.title = t('timetableImport.groups.grid', { count: group.rows.length });
  }

  // What goes in anyway, said once per kind.
  const notes = new Map<string, number>();
  for (const row of rows) {
    if (dropped.includes(row.index)) continue;
    for (const warning of row.warnings) notes.set(warning.code, (notes.get(warning.code) ?? 0) + 1);
  }

  const importable = rows.filter((row) => row.importable && !dropped.includes(row.index)).length;

  return (
    <div className="flex flex-col gap-3">
      {groups.size > 0 && (
        <ul className="flex flex-col gap-2">
          {[...groups.values()].map((group) => {
            const shown = open === group.key;
            const indexes = group.rows.map((row) => row.index);
            return (
              <li key={group.key} className="rounded border border-warning/40 bg-warning/5 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1 font-medium">
                    {group.kind === 'problem' || group.kind === 'rule'
                      ? t('timetableImport.groups.counted', { count: group.rows.length, what: group.title })
                      : group.title}
                  </span>
                  {group.kind === 'hours' && hoursNeeded.length > 0 && (
                    <button type="button" disabled={working} onClick={() => setAskHours(true)} className={PRIMARY}>
                      {t('timetableImport.groups.extendHours')}
                    </button>
                  )}
                  {group.kind === 'file' && (
                    <button
                      type="button"
                      disabled={working}
                      // Each clash sits on the later line, against an earlier one: dropping these keeps the first of each.
                      onClick={() => onDrop(indexes)}
                      className={PRIMARY}
                    >
                      {t('timetableImport.groups.keepFirst')}
                    </button>
                  )}
                  {group.kind !== 'file' && (
                    <button type="button" disabled={working} onClick={() => onDrop(indexes)} className={QUIET}>
                      {t('timetableImport.groups.dropThese', { count: group.rows.length })}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={shown}
                    onClick={() => setOpen(shown ? null : group.key)}
                    className="inline-flex items-center gap-1 text-sm underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <ChevronRight aria-hidden className={cn('size-4 transition-transform', shown && 'rotate-90')} />
                    {shown ? t('timetableImport.groups.hide') : t('timetableImport.groups.show')}
                  </button>
                </div>

                {group.kind === 'hours' && (
                  <ul className="mt-2 flex flex-col gap-0.5 pl-6 text-foreground-muted">
                    {hoursNeeded.map((day) => (
                      <li key={day.weekday}>
                        {t('timetableImport.groups.hoursLine', {
                          day: t(`week.${day.weekday}`),
                          now:
                            day.current === null || !day.current.available
                              ? t('timetableImport.groups.closed')
                              : `${day.current.opens}–${day.current.closes}`,
                          needed: `${day.needed.opens}–${day.needed.closes}`,
                          count: day.rows,
                        })}
                      </li>
                    ))}
                  </ul>
                )}

                {shown && (
                  <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto border-t border-warning/30 pt-2 pl-6">
                    {group.rows.map((row) => {
                      const other = blocking(row)[0];
                      return (
                        <li key={row.index} className="text-foreground-muted">
                          <span className="font-medium text-foreground">{row.name}</span> · {t(`week.${row.weekday}`)}{' '}
                          {clock(row.startMinutes)}
                          {row.laneNames.length > 0 && ` · ${row.laneNames.join(', ')}`}
                          {' · '}
                          {t('timetableImport.line', { line: row.line })}
                          {other?.with != null && ` — ${t('timetableImport.groups.with', { name: other.with })}`}
                          {other?.withLine != null && ` (${t('timetableImport.line', { line: other.withLine })})`}
                          {row.problems[0]?.value !== undefined && ` — «${row.problems[0].value}»`}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {notes.size > 0 && (
        <ul className="flex flex-col gap-1 rounded border border-border p-3 text-sm text-foreground-muted">
          {[...notes.entries()].map(([code, count]) => (
            <li key={code} className="flex items-start gap-2">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t(`timetableImport.groups.note.${code in NOTES ? code : 'other'}`, { count })}
            </li>
          ))}
        </ul>
      )}

      {/* Left out rows are not in the answer any more: the list of their numbers is what is kept. */}
      {dropped.length > 0 && (
        <p className="text-sm text-foreground-muted">
          {t('timetableImport.groups.dropped', { count: dropped.length })}{' '}
          <button
            type="button"
            disabled={working}
            onClick={() => onKeep(dropped)}
            className="underline underline-offset-4 hover:text-primary"
          >
            {t('timetableImport.groups.undrop')}
          </button>
        </p>
      )}

      {groups.size > 0 && importable > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={working}
            onClick={() => onImportClean(held.map((row) => row.index))}
            className={PRIMARY}
          >
            {t('timetableImport.groups.importClean', { count: importable })}
          </button>
          <span className="text-sm text-foreground-muted">
            {t('timetableImport.groups.importCleanHint', { count: held.length })}
          </span>
        </div>
      )}

      {/* A decision asks first, in the shared dialog. */}
      <Dialog
        open={askHours}
        onClose={() => setAskHours(false)}
        title={t('timetableImport.groups.extendAsk')}
        closeLabel={t('common.close')}
        className="max-w-md"
      >
        <div className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-0.5 text-foreground-muted">
            {hoursNeeded.map((day) => (
              <li key={day.weekday}>
                {t(`week.${day.weekday}`)}: {day.needed.opens}–{day.needed.closes}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => {
                setAskHours(false);
                onExtendHours();
              }}
              className={PRIMARY}
            >
              {t('timetableImport.groups.extendConfirm')}
            </button>
            <button type="button" onClick={() => setAskHours(false)} className={QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** The rules with a sentence of their own; anything else reads as "other". */
const REASONS = {
  laneTaken: true,
  instructorElsewhere: true,
  lanesNotContiguous: true,
  dayClosed: true,
  overCapacity: true,
  overConcurrency: true,
} as const;

/** The notes with a sentence of their own. */
const NOTES = {
  noLanes: true,
  lanesPlaced: true,
  lanesShort: true,
  lanesOverPool: true,
  instructorNotFound: true,
  headcountMissing: true,
} as const;

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
