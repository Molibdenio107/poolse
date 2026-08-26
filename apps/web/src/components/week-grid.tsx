import { cn } from '@/lib/utils';

export interface WeekEntry {
  key: string;
  /** ISO weekday: Monday 1 … Sunday 7. */
  weekday: number;
  /** Wall-clock "HH:MM" at the facility. */
  startTime: string;
  durationMinutes: number;
  title: string;
  /** Pool, lane, instructor — whatever identifies the slot at a glance. */
  subtitle?: string | null;
  /** Who is in it. Shown small, because the point of the grid is who and when. */
  people?: string[];
  href?: string;
  muted?: boolean;
  /** Why this one is off — "Natal", "Férias de agosto". Shown under the title. */
  note?: string | null;
  /** Struck through: the class is not happening. */
  cancelled?: boolean;
  /** A control for this slot — cancel, restore. Rendered outside the link. */
  action?: React.ReactNode;
}

/**
 * Seven columns of a week.
 *
 * Used for both things the app calls a week, and the caller decides which by
 * what it puts in `dayNames`: the turma screens pass "Terça" and mean the
 * recurring pattern, the calendar screens pass "Terça · 15 dez" and mean that
 * actual Tuesday. The grid itself takes no view — which is why it can be one
 * component rather than two that drift apart.
 *
 * What separates them in substance is `cancelled` and `note`. A pattern has no
 * way to say "except the 15th"; a dated week does, and says why.
 *
 * Seven columns on a wide screen, stacked on a narrow one. No horizontal
 * scrolling: an operator checking the week on a laptop should not have to drag
 * sideways to reach Friday.
 */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function WeekGrid({
  entries,
  dayNames,
  emptyLabel,
  className,
}: {
  entries: WeekEntry[];
  /** Indexed by ISO weekday, so dayNames[1] is Monday. Supplied translated. */
  dayNames: Record<number, string>;
  emptyLabel: string;
  className?: string;
}): React.ReactElement {
  const byDay = new Map<number, WeekEntry[]>();
  for (const entry of entries) {
    byDay.set(entry.weekday, [...(byDay.get(entry.weekday) ?? []), entry]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // Monday to Saturday always. Saturday morning is when a swimming school runs
  // half its children's classes, so a grid that hid it until something appeared
  // there had the week wrong. Sunday shows up only when it is used — most pools
  // do not open, and an empty seventh column makes the six that matter narrower.
  const days = WEEKDAYS.filter((day) => day <= 6 || (byDay.get(day)?.length ?? 0) > 0);

  if (entries.length === 0) {
    return (
      <p className={cn('text-sm text-foreground-muted', className)}>{emptyLabel}</p>
    );
  }

  return (
    <div
      className={cn('grid gap-3', className)}
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
    >
      {days.map((day) => (
        <div key={day} className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {dayNames[day]}
          </h3>

          {(byDay.get(day) ?? []).length === 0 ? (
            <span className="text-sm text-foreground-muted">—</span>
          ) : (
            (byDay.get(day) ?? []).map((entry) => (
              <Slot key={entry.key} entry={entry} />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function Slot({ entry }: { entry: WeekEntry }): React.ReactElement {
  const body = (
    <>
      <span className="font-mono text-sm">
        {entry.startTime}
        <span className="text-foreground-muted"> · {entry.durationMinutes}′</span>
      </span>
      <span className={cn('truncate font-medium', entry.cancelled === true && 'line-through')}>
        {entry.title}
      </span>
      {entry.subtitle != null && (
        <span className="truncate text-sm text-foreground-muted">{entry.subtitle}</span>
      )}
      {/*
        Never truncated, unlike the subtitle. "Why is there no class on the
        15th?" is the question this whole screen exists to answer, and an answer
        cut off at the edge of a column answers nothing.
      */}
      {entry.note != null && entry.note !== '' && (
        <span className="mt-1 text-sm font-medium text-warning">{entry.note}</span>
      )}
      {entry.people !== undefined && entry.people.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-sm text-foreground-muted">
          {entry.people.map((person) => (
            <li key={person} className="truncate">
              {person}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const classes = cn(
    'flex flex-col rounded border p-2',
    entry.muted
      ? 'border-dashed border-border bg-surface-muted'
      : 'border-border bg-surface hover:border-primary/50',
  );

  // A link when there is somewhere to go, a plain block when there is not —
  // rather than an anchor with no href, which is a control that looks clickable
  // and is not.
  const card =
    entry.href === undefined ? (
      <div className={classes}>{body}</div>
    ) : (
      <a href={entry.href} className={classes}>
        {body}
      </a>
    );

  if (entry.action === undefined) return card;

  // Outside the anchor, deliberately: a form nested inside a link is invalid
  // HTML, and browsers resolve it by making the button navigate instead of
  // submit — a cancel control that opens the turma page.
  return (
    <div className="flex flex-col gap-1">
      {card}
      <div className="px-2">{entry.action}</div>
    </div>
  );
}
