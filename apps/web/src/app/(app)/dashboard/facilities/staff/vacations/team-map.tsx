'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { TeamVacations } from '@/lib/api';
import { YearGrid, type DayState } from '@/components/year-grid';

/**
 * "Mapa da equipa" — backlog round 3, story 8.
 *
 * **Nobody is shown until somebody is ticked**, which the story asks for and
 * which is also the only way this screen is readable: twelve people painted at
 * once over a year is a colour field, not information.
 *
 * **Colour is never the only cue.** Each selected person gets a hue, but every
 * day also carries an initial, and its accessible name lists who is away by
 * name. A day two people share says so rather than letting one colour hide the
 * other. This is the rule from CLAUDE.md applied to the one screen where it is
 * easiest to break.
 */

/**
 * Chosen to stay distinguishable under the common colour-vision deficiencies —
 * they differ in lightness as well as hue, so they survive being read as greys.
 * Six because a seventh selected person is past the point where any palette
 * helps; beyond that the initials and the tooltip carry it.
 */
const HUES = [
  { dot: 'bg-[#3b7ea1]', cell: 'bg-[#3b7ea1] text-white' },
  { dot: 'bg-[#c58f2e]', cell: 'bg-[#c58f2e] text-white' },
  { dot: 'bg-[#4a9b6a]', cell: 'bg-[#4a9b6a] text-white' },
  { dot: 'bg-[#8b5fa8]', cell: 'bg-[#8b5fa8] text-white' },
  { dot: 'bg-[#be473e]', cell: 'bg-[#be473e] text-white' },
  { dot: 'bg-[#4f5d6b]', cell: 'bg-[#4f5d6b] text-white' },
];

function initialOf(name: string | null): string {
  return name === null || name.trim() === '' ? '?' : name.trim()[0]!.toUpperCase();
}

export function TeamMap({ data }: { data: TeamVacations }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  // Empty on purpose. The story is explicit and the reason is legibility.
  const [shown, setShown] = useState<Set<string>>(new Set());

  const holidays = useMemo(
    () => new Map(data.holidays.map((holiday) => [holiday.day, holiday])),
    [data.holidays],
  );

  const hueFor = useMemo(() => {
    const map = new Map<string, (typeof HUES)[number]>();
    data.members.forEach((member, index) => {
      map.set(member.membershipId, HUES[index % HUES.length]!);
    });
    return map;
  }, [data.members]);

  /** Day → the selected people off that day. Built once, not searched per cell. */
  const offByDay = useMemo(() => {
    const map = new Map<string, { name: string | null; membershipId: string }[]>();
    for (const member of data.members) {
      if (!shown.has(member.membershipId)) continue;
      for (const day of member.days) {
        const list = map.get(day) ?? [];
        list.push({ name: member.name, membershipId: member.membershipId });
        map.set(day, list);
      }
    }
    return map;
  }, [data.members, shown]);

  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(data.year, index, 1)),
        ),
      ),
    [locale, data.year],
  );

  const weekdayInitials = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2024, 0, 1 + index)),
        ),
      ),
    [locale],
  );

  function labelFor(day: string): string {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  }

  function stateFor(day: string): DayState {
    const holiday = holidays.get(day);
    if (holiday !== undefined) {
      return {
        disabled: true,
        description: holiday.name,
        marker: '•',
        className: 'bg-warning/10 text-warning',
      };
    }
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) return { disabled: true };

    const off = offByDay.get(day);
    if (off === undefined || off.length === 0) return {};

    const names = off.map((person) => person.name ?? t('account.noName'));

    // Shared days are marked as shared rather than painted one person's colour,
    // which would hide the other entirely — the exact failure the story names.
    if (off.length > 1) {
      return {
        className: 'bg-foreground text-background font-semibold',
        description: t('vacations.sharedDay', { names: names.join(', ') }),
        marker: `${off.length}`,
      };
    }

    const hue = hueFor.get(off[0]!.membershipId)!;
    return {
      className: `${hue.cell} font-medium`,
      description: names[0]!,
      marker: initialOf(off[0]!.name),
    };
  }

  function toggle(membershipId: string): void {
    setShown((current) => {
      const next = new Set(current);
      if (next.has(membershipId)) next.delete(membershipId);
      else next.add(membershipId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('vacations.showEveryone')}
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShown(new Set(data.members.map((m) => m.membershipId)))}
              className="rounded text-sm text-primary hover:underline"
            >
              {t('vacations.selectAll')}
            </button>
            <button
              type="button"
              onClick={() => setShown(new Set())}
              className="rounded text-sm text-foreground-muted hover:text-foreground"
            >
              {t('vacations.selectNone')}
            </button>
          </div>
        </div>

        {data.members.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('vacations.noTeam')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.members.map((member) => {
              const hue = hueFor.get(member.membershipId)!;
              const on = shown.has(member.membershipId);
              return (
                <li key={member.membershipId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(member.membershipId)}
                      className="size-4 accent-primary"
                    />
                    {/* The legend swatch, paired with the initial that also
                        appears in the grid — two cues for the same person. */}
                    <span
                      aria-hidden
                      className={`inline-flex size-4 items-center justify-center rounded text-[0.6rem] font-semibold text-white ${hue.dot}`}
                    >
                      {initialOf(member.name)}
                    </span>
                    <span className="truncate">{member.name ?? t('account.noName')}</span>
                    <span className="text-foreground-muted">
                      {t('vacations.dayCount', { count: member.days.length })}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {shown.size === 0 ? (
        <p className="rounded border border-dashed border-border p-8 text-center text-sm text-foreground-muted">
          {t('vacations.pickSomeone')}
        </p>
      ) : (
        <YearGrid
          year={data.year}
          monthNames={monthNames}
          weekdayInitials={weekdayInitials}
          stateFor={stateFor}
          labelFor={labelFor}
        />
      )}
    </div>
  );
}
