import { Hint } from '@/components/ui/tooltip';
import { TurmaHoverCard, type TurmaDetail } from '@/components/turma-card';
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
  /**
   * Who is in it — POOLSE-08. Shown small, because the point of the grid is who
   * and when.
   */
  people?: string[];
  /** Shown in place of the list when nobody is enrolled. Absent renders nothing. */
  peopleEmpty?: string | undefined;
  /** "+3 mais", already translated and pluralised. Shown when the list is cut. */
  peopleMore?: string | undefined;
  href?: string;
  muted?: boolean;
  /** Why this one is off — "Natal", "Férias de agosto". Shown under the title. */
  note?: string | null;
  /** Struck through: the class is not happening. */
  cancelled?: boolean;
  /** A control for this slot — cancel, restore. Rendered outside the link. */
  action?: React.ReactNode;
  /**
   * A second destination for the slot, drawn under the card — slice 1.8.
   *
   * Explicitly `| undefined` because `exactOptionalPropertyTypes` is on: a
   * caller computing this conditionally hands over `undefined`, and without it
   * the type says the key must be absent entirely.
   */
  mark?: { href: string; label: string } | undefined;
  /**
   * The full turma, for the hover panel — POOLSE-15.
   *
   * Absent means the slot keeps the plain tooltip. The calendar's cancelled and
   * closed days pass nothing: there is no roll to show for a class that is not
   * happening, and a panel that opened to say so would be noise on the one
   * screen that already explains itself.
   */
  detail?: TurmaDetail | undefined;
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

/**
 * How many names a slot shows before it collapses — POOLSE-08 suggests eight.
 *
 * Eight is about the height of the other things in a slot, so a full turma does
 * not make its column twice as tall as its neighbours.
 */
const MAX_NAMES = 8;

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

  // An empty week still gets its grid.
  //
  // It used to collapse to a single line of grey text, and that is how the
  // calendar came to look like a page that had failed to load: no days, no
  // columns, nothing that reads as a calendar at all. The days are the part that
  // says "this is a week and it is empty" rather than "this is broken" — so they
  // are drawn either way, and the label sits above them saying which week and
  // why there is nothing in it.
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {entries.length === 0 && (
        <p className="text-sm text-foreground-muted">{emptyLabel}</p>
      )}

      <div
        className="grid gap-3"
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
      {/*
        Backlog round 3, story 4. `line-clamp-2` rather than `truncate`: a turma
        called "Adaptação ao Meio Aquático 4" lost everything after the first
        word in a column one seventh of the screen wide, and every turma in the
        level then looked identical. Two lines fit the names a swimming school
        actually uses, and `break-words` keeps the wrap on word boundaries — the
        story is explicit that nothing is cut mid-word.
      */}
      <span
        className={cn(
          'line-clamp-2 break-words font-medium',
          entry.cancelled === true && 'line-through',
        )}
      >
        {entry.title}
      </span>
      {entry.subtitle != null && (
        <span className="line-clamp-2 break-words text-sm text-foreground-muted">
          {entry.subtitle}
        </span>
      )}
      {/*
        Never truncated, unlike the subtitle. "Why is there no class on the
        15th?" is the question this whole screen exists to answer, and an answer
        cut off at the edge of a column answers nothing.
      */}
      {entry.note != null && entry.note !== '' && (
        <span className="mt-1 text-sm font-medium text-warning">{entry.note}</span>
      )}
      {/*
        POOLSE-08. A real bulleted list, one step smaller than the card's title
        and in the muted tone — still a token, so it stays contrast-compliant in
        both themes rather than being a hand-picked grey.
      */}
      {entry.people !== undefined && entry.people.length > 0 && (
        <ul className="mt-1 flex list-inside list-disc flex-col gap-0.5 text-sm text-foreground-muted">
          {entry.people.slice(0, MAX_NAMES).map((person) => (
            <li key={person} className="truncate">
              {person}
            </li>
          ))}
          {/*
            Cut rather than stretched. A turma of thirty would make its column
            taller than the six beside it and push the whole week off the screen;
            the count says how many are not shown, and the card links to the
            turma where they all are.
          */}
          {entry.peopleMore !== undefined && entry.people.length > MAX_NAMES && (
            <li className="list-none text-foreground-muted/80">{entry.peopleMore}</li>
          )}
        </ul>
      )}

      {entry.people?.length === 0 && entry.peopleEmpty !== undefined && (
        <span className="mt-1 text-sm text-foreground-muted">{entry.peopleEmpty}</span>
      )}
    </>
  );

  // `min-h` and the roomier padding are the readable-cell half of story 4: the
  // time, the name and the pool are three lines, and a box sized to two of them
  // made every slot look clipped even when it was not.
  const classes = cn(
    'flex min-h-24 flex-col gap-0.5 rounded border p-3',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    entry.muted
      ? 'border-dashed border-border bg-surface-muted'
      : 'border-border bg-surface hover:border-primary/50',
  );

  // A link when there is somewhere to go, a plain block when there is not —
  // rather than an anchor with no href, which is a control that looks clickable
  // and is not.
  const plain =
    entry.href === undefined ? (
      <div className={classes}>{body}</div>
    ) : (
      <a href={entry.href} className={classes}>
        {body}
      </a>
    );

  /*
   * The safety net for a name still too long for two lines.
   *
   * Radix opens this on keyboard focus as well as hover, which is what makes it
   * allowable at all — CLAUDE.md forbids a tooltip being the only way to reach
   * something, and a mouse-only one would be exactly that. It repeats text that
   * is already on screen, and the slot links to the turma's own page where the
   * full name is plain text, so nothing lives only in here.
   */
  const full = [entry.title, entry.subtitle, entry.note].filter(Boolean).join(' · ');

  /*
   * The hover panel replaces the tooltip rather than sitting beside it —
   * POOLSE-15. Two things opening from one hover, at two delays, is the flicker
   * the ticket asks to avoid; and the panel already shows the full name, which
   * is all the tooltip was for.
   */
  const card =
    entry.detail === undefined ? (
      <Hint text={full}>{plain}</Hint>
    ) : (
      <TurmaHoverCard title={entry.title} detail={entry.detail}>
        {plain}
      </TurmaHoverCard>
    );

  if (entry.action === undefined && entry.mark === undefined) return card;

  // Outside the anchor, deliberately: a form nested inside a link is invalid
  // HTML, and browsers resolve it by making the button navigate instead of
  // submit — a cancel control that opens the turma page.
  return (
    <div className="flex flex-col gap-1">
      {card}
      <div className="flex flex-col gap-1 px-2">
        {entry.mark !== undefined && (
          <a
            href={entry.mark.href}
            className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {entry.mark.label}
          </a>
        )}
        {entry.action}
      </div>
    </div>
  );
}
