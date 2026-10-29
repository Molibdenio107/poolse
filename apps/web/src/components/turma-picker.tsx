'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/**
 * Choosing a turma — POOLSE-110. A list, not a `<select>`.
 *
 * A native dropdown of thirty "Golfinhos · Iniciação · 8/12" lines is a wall of
 * near-identical text, so each turma is a row: its name in bold, its weekly
 * slots, its instructor and how full it is — a bar *and* "8 / 12", never colour
 * alone. **Grouped by level**, the level the family asked for first and labelled
 * *Nível pedido*, then the ladder in order. **A search box filters as you type**
 * — by turma, level or instructor, accents and case ignored — with no button.
 *
 * **A full turma is shown, greyed and marked *cheia*,** so "why not this one"
 * is on the screen; it can be picked only where `allowFull` says so (the
 * waiting list), and the server refuses the rest anyway.
 *
 * **Keyboard:** the search box owns the list (a combobox): arrows move through
 * the pickable rows, Enter picks, Escape closes the list back to an earlier
 * choice (`data-own-escape`, which the dialog respects). What was picked is
 * announced, and then shown back as one line with *alterar*, so the person
 * confirms what they chose. Inside a dialog, a phone gets it full height for
 * free: the dialog is a full-screen sheet below `sm`.
 *
 * **Grouped by something else when the caller says so** (POOLSE-113): rows that
 * all carry `group` are grouped by it, in its order, and keep the order they
 * came in — the advancement queue groups its candidates by rank reason, since
 * every one of them is at the same level and a level heading would hide the
 * ranking. Rows without it are grouped by level, as above.
 *
 * Used by the three Pedidos dialogs and the advancement queue; the app's
 * enrolment is meant to swap to it next (POOLSE-110 dev notes).
 */

export interface TurmaOption {
  id: string;
  name: string;
  levelName: string | null;
  /** The level's place in the ladder, for ordering the groups; null sorts last. */
  levelOrder: number | null;
  capacity: number | null;
  active: number;
  /** ISO weekday (Monday 1) and "HH:MM", in the order they run. */
  slots: { weekday: number; startTime: string }[];
  instructorName: string | null;
  /**
   * A grouping that replaces the level's, when every row has one — POOLSE-113.
   * `label` is the heading in words; `order` places the group. Within a group
   * the rows keep the order they were given.
   */
  group?: { key: string; label: string; order: number } | undefined;
}

interface Group {
  key: string;
  label: string;
  requested: boolean;
  turmas: TurmaOption[];
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function isFull(turma: TurmaOption): boolean {
  return turma.capacity !== null && turma.active >= turma.capacity;
}

export function TurmaPicker({
  name,
  label,
  turmas,
  requestedLevelName,
  allowFull,
  error,
  onChange,
  initialValue,
}: {
  /** The form field the chosen id is posted as. */
  name: string;
  label: string;
  turmas: TurmaOption[];
  /** The level the request asked for; its group comes first. */
  requestedLevelName: string | null;
  /** Whether a full turma may be picked — the waiting list, and nothing else. */
  allowFull: boolean;
  error?: string | undefined;
  onChange?: ((id: string) => void) | undefined;
  /** A turma to start on — the one a family asked for (POOLSE-121). */
  initialValue?: string | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const id = useId();
  const start = initialValue !== undefined && turmas.some((turma) => turma.id === initialValue) ? initialValue : '';
  const [value, setValue] = useState(start);
  const [open, setOpen] = useState(start === '');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const change = useRef<HTMLButtonElement>(null);

  const slotsOf = (turma: TurmaOption): string =>
    turma.slots.map((slot) => `${t(`weekShort.${slot.weekday}`)} ${slot.startTime}`).join(' · ');
  const fillOf = (turma: TurmaOption): string =>
    turma.capacity === null
      ? t('turmaPicker.uncapped', { active: turma.active })
      : t('turmaPicker.fill', { active: turma.active, capacity: turma.capacity });

  const groups = useMemo<Group[]>(() => {
    const needle = fold(query.trim());
    const matching = turmas.filter(
      (turma) =>
        needle === '' ||
        [turma.name, turma.levelName ?? '', turma.instructorName ?? ''].some((text) => fold(text).includes(needle)),
    );
    // The caller's grouping when every row has one, else the level's.
    const callerGroups = turmas.length > 0 && turmas.every((turma) => turma.group !== undefined);
    const byLevel = new Map<string, Group & { order: number }>();
    for (const turma of matching) {
      const own = callerGroups ? turma.group! : null;
      const key = own?.key ?? turma.levelName ?? '';
      const requested = own === null && requestedLevelName !== null && turma.levelName === requestedLevelName;
      const group = byLevel.get(key) ?? {
        key,
        label: own?.label ?? turma.levelName ?? t('turmaPicker.noLevel'),
        requested,
        // The caller's order; else the requested level first, then the ladder,
        // then turmas with no level.
        order: own?.order ?? (requested ? -1 : (turma.levelOrder ?? Number.MAX_SAFE_INTEGER)),
        turmas: [],
      };
      group.turmas.push(turma);
      byLevel.set(key, group);
    }
    return [...byLevel.values()]
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      // Within a group, the turmas that can be picked first; a full one after
      // them. A level's are alphabetical; a caller's keep the order given.
      .map((group) => ({
        ...group,
        turmas: group.turmas.sort(
          (a, b) =>
            Number(isFull(a) && !allowFull) - Number(isFull(b) && !allowFull) ||
            (callerGroups ? 0 : a.name.localeCompare(b.name)),
        ),
      }));
  }, [turmas, query, requestedLevelName, allowFull, t]);

  const pickable = (turma: TurmaOption): boolean => allowFull || !isFull(turma);
  const order = groups.flatMap((group) => group.turmas).filter(pickable);
  const chosen = turmas.find((turma) => turma.id === value) ?? null;
  const optionId = (turmaId: string): string => `${id}-option-${turmaId}`;

  const pick = (turma: TurmaOption): void => {
    if (!pickable(turma)) return;
    setValue(turma.id);
    setOpen(false);
    setQuery('');
    setAnnouncement(t('turmaPicker.picked', { name: turma.name }));
    onChange?.(turma.id);
    // Focus follows the choice to the line that shows it back.
    requestAnimationFrame(() => change.current?.focus());
  };

  const reopen = (): void => {
    setOpen(true);
    setActive(value === '' ? null : value);
    requestAnimationFrame(() => search.current?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (order.length === 0) return;
      const at = active === null ? -1 : order.findIndex((turma) => turma.id === active);
      const next =
        event.key === 'ArrowDown'
          ? order[Math.min(order.length - 1, at + 1)]!
          : order[Math.max(0, at === -1 ? 0 : at - 1)]!;
      setActive(next.id);
      document.getElementById(optionId(next.id))?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      // Enter picks; it never submits the dialog from inside the list.
      event.preventDefault();
      const turma = order.find((option) => option.id === active);
      if (turma !== undefined) pick(turma);
    } else if (event.key === 'Escape' && chosen !== null) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      requestAnimationFrame(() => change.current?.focus());
    }
  };

  return (
    <div className="flex flex-col gap-2" {...(open && chosen !== null ? { 'data-own-escape': '' } : {})}>
      <input type="hidden" name={name} value={value} />
      <span id={`${id}-label`} className={FIELD_LABEL}>
        {label}
      </span>

      {/* The choice, said back — POOLSE-110 BA 2. */}
      {!open && chosen !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface-muted p-3">
          <p className="text-sm">
            <span className="font-medium">{chosen.name}</span>
            {chosen.slots.length > 0 && ` · ${slotsOf(chosen)}`} · {fillOf(chosen)}
          </p>
          <button
            ref={change}
            type="button"
            onClick={reopen}
            aria-label={t('turmaPicker.changeLabel', { name: chosen.name })}
            className="inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('turmaPicker.change')}
          </button>
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-2 rounded border border-border">
          <div className="relative p-2">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" />
            <input
              ref={search}
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-labelledby={`${id}-label`}
              aria-describedby={`${id}-hint`}
              aria-autocomplete="list"
              {...(active === null ? {} : { 'aria-activedescendant': optionId(active) })}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(null);
              }}
              onKeyDown={onKeyDown}
              placeholder={t('turmaPicker.search')}
              className="h-control w-full rounded border border-border bg-surface pl-9 pr-2 text-control"
            />
            <p id={`${id}-hint`} className="sr-only">
              {t('turmaPicker.keyboardHint')}
            </p>
          </div>

          <div
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="flex max-h-[min(24rem,55dvh)] flex-col overflow-y-auto border-t border-border max-sm:max-h-[60dvh]"
          >
            {groups.length === 0 && (
              <p className="p-3 text-sm text-foreground-muted">{t('turmaPicker.noMatch')}</p>
            )}
            {groups.map((group) => (
              <div key={group.key} role="group" aria-labelledby={`${id}-group-${group.key}`}>
                <p
                  id={`${id}-group-${group.key}`}
                  className="sticky top-0 z-10 bg-surface-muted px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground-muted"
                >
                  {group.requested ? t('turmaPicker.requestedLevel', { level: group.label }) : group.label}
                </p>
                {group.turmas.map((turma) => {
                  const full = isFull(turma);
                  const canPick = pickable(turma);
                  const percent =
                    turma.capacity === null || turma.capacity === 0
                      ? 0
                      : Math.min(100, Math.round((turma.active / turma.capacity) * 100));
                  return (
                    <div
                      key={turma.id}
                      id={optionId(turma.id)}
                      role="option"
                      aria-selected={turma.id === value}
                      aria-disabled={!canPick}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pick(turma)}
                      className={cn(
                        'flex items-start justify-between gap-3 border-t border-border px-3 py-2 first-of-type:border-t-0',
                        // Greyed by the muted ink rather than by opacity, which would
                        // take the words under AA contrast.
                        canPick ? 'cursor-pointer hover:bg-surface-muted' : 'cursor-not-allowed text-foreground-muted',
                        turma.id === active && 'bg-surface-muted outline outline-2 -outline-offset-2 outline-primary',
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className={cn('font-medium', !canPick && 'text-foreground-muted')}>{turma.name}</span>
                        <span className="text-sm text-foreground-muted">
                          {turma.slots.length > 0 ? slotsOf(turma) : t('turmaPicker.noSlots')}
                        </span>
                        <span className="text-sm text-foreground-muted">
                          {turma.instructorName ?? t('turmaPicker.noInstructor')}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 text-sm tabular-nums">
                        <span>{fillOf(turma)}</span>
                        {turma.capacity !== null && (
                          <span
                            aria-hidden
                            className="block h-1.5 w-16 overflow-hidden rounded-full border border-border bg-surface-muted"
                          >
                            <span className="block h-full bg-chart-1" style={{ width: `${percent}%` }} />
                          </span>
                        )}
                        {full && (
                          <span className="text-xs font-medium">
                            {allowFull ? t('turmaPicker.fullWaitlist') : t('turmaPicker.full')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What was picked, said once to a screen reader. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {error !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
