import { attentionClass } from '@/components/attention-dot';
import { getTranslations } from 'next-intl/server';
import { CalendarDays, ChevronRight, Waves, User } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { AttentionDot } from '@/components/attention-dot';
import { PageEmpty } from '@/components/page-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { ClassGroup } from '@/lib/api';
import { classColourVar } from '@/lib/calendar-scale';
import { cn } from '@/lib/utils';
import { JoinTurmas } from './join-turmas';

/**
 * The turmas as cards — multi-sport Slice 4, the handoff's *05 Turmas* (Rui,
 * 01-11-2026; the calendar's states wait for a mockup on the real calendar).
 *
 * Each card says what an office scans for: whether the turma is **open, full or
 * without an instructor** (a badge, a word, never the colour alone), when it
 * meets, who teaches it — in amber when nobody does — where, how full it is
 * against its capacity, and who is waiting. A turma with nobody teaching it is
 * outlined, the one that needs doing first. A capacity left empty is "not
 * measured", never zero: the bar says *sem limite* instead of drawing a fill.
 */
type State = 'open' | 'full' | 'noInstructor';

/**
 * Turmas that are one class at several hours — "Hidroginástica · 07:00",
 * "Hidroginástica · 08:00" — fold under one heading (Rui, 14-11-2026). A turma
 * is a group of students, so a class taught to different people at different
 * hours is rightly several turmas; what was wrong was thirteen cards in a row
 * saying the same word. The key is the name before " · HH:MM", the form the
 * timetable import gives them; any other name is its own key.
 */
const AT_HOUR = /\s·\s\d{1,2}:\d{2}$/;
export function sameNameKey(name: string): string {
  return name.replace(AT_HOUR, '').trim().toLocaleLowerCase('pt-PT');
}
function baseName(name: string): string {
  return name.replace(AT_HOUR, '').trim();
}
const TONE: Record<State, BadgeTone> = { open: 'ok', full: 'pending', noInstructor: 'late' };

export async function TurmaCards({
  groups,
  canManage,
  flagged = {},
}: {
  groups: ClassGroup[];
  canManage: boolean;
  /** POOLSE-211: turmas with nobody teaching them, from the attention map (the office's). */
  flagged?: Record<string, number>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  // How many of these cards are flagged: one is boxed, more get the accent bar (POOLSE-216).
  const flaggedHere = groups.filter((group) => (flagged[group.id] ?? 0) > 0).length;
  if (groups.length === 0) {
    return (
      <PageEmpty
        icon={CalendarDays}
        message={t('classes.none')}
        hint={canManage ? t('classes.noneHintManager') : t('classes.noneHintMember')}
      />
    );
  }

  // In the order the page gave them; a set of the same name sits where its first one did.
  const sets: ClassGroup[][] = [];
  const byKey = new Map<string, ClassGroup[]>();
  for (const group of groups) {
    const key = sameNameKey(group.name);
    const set = byKey.get(key);
    if (set === undefined) {
      const fresh = [group];
      byKey.set(key, fresh);
      sets.push(fresh);
    } else {
      set.push(group);
    }
  }

  const scheduleOf = (group: ClassGroup): string =>
    [...group.schedules]
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
      .map((slot) => `${t(`weekShort.${slot.weekday}`)} ${slot.startTime}`)
      .join(' · ');

  const card = (group: ClassGroup): React.ReactElement => {
        const active = group.students.filter((s) => s.status === 'active').length;
        const waiting = group.students.filter((s) => s.status === 'waiting').length;
        const full = group.capacity !== null && active >= group.capacity;
        const state: State = group.instructorMembershipId === null ? 'noInstructor' : full ? 'full' : 'open';
        const colour = classColourVar(group.colour);
        const schedule = scheduleOf(group);
        return (
          <section
            key={group.id}
            className={cn(
              'flex flex-col gap-3 rounded bg-surface p-5 shadow-card',
              // Nobody teaching it (POOLSE-211, -214): the shared emphasis, beside its dot.
              (flagged[group.id] ?? 0) > 0 && attentionClass(flaggedHere),
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <FromLink
                href={`/dashboard/classes/${group.id}`}
                className="flex min-w-0 items-center gap-2 font-heading text-[15px] font-semibold text-foreground hover:underline"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full bg-foreground/20"
                  {...(colour === null ? {} : { style: { backgroundColor: colour } })}
                />
                <span className="truncate">{group.name}</span>
                <AttentionDot count={flagged[group.id]} label={t('classes.cards.state.noInstructor')} />
              </FromLink>
              <Badge tone={TONE[state]}>{t(`classes.cards.state.${state}`)}</Badge>
            </div>

            <div className="flex flex-col gap-1 text-sm">
              {group.levelName !== null && <p className="text-foreground-muted">{group.levelName}</p>}
              <p>{schedule === '' ? <span className="text-foreground-muted">{t('classes.cards.noSchedule')}</span> : schedule}</p>
              <p className={cn('flex items-center gap-1.5', state === 'noInstructor' && 'font-semibold text-warning')}>
                <User aria-hidden className="size-4 shrink-0" />
                {group.instructorName ?? t('classes.cards.noInstructor')}
              </p>
              {group.poolName !== null && (
                <p className="flex items-center gap-1.5 text-foreground-muted">
                  <Waves aria-hidden className="size-4 shrink-0" />
                  {group.poolName}
                  {group.lane === null ? '' : ` · ${t('classes.laneN', { lane: group.lane })}`}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-foreground-muted">{t('classes.cards.capacity')}</span>
              {group.capacity === null ? (
                <span className="font-mono text-xs tabular-nums">{t('classes.cards.noLimit', { count: active })}</span>
              ) : (
                <>
                  <span
                    role="img"
                    aria-label={t('classes.cards.fill', { active, capacity: group.capacity })}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
                  >
                    <span
                      className={cn('block h-full rounded-full', full ? 'bg-[rgb(var(--primary-ink))]' : 'bg-primary')}
                      style={{ width: `${Math.min(100, (active / Math.max(1, group.capacity)) * 100)}%` }}
                    />
                  </span>
                  <span className="font-mono text-xs tabular-nums">
                    {t('classes.cards.fill', { active, capacity: group.capacity })}
                  </span>
                </>
              )}
              {waiting > 0 && (
                <span className="text-xs text-warning">{t('classes.cards.waiting', { count: waiting })}</span>
              )}
            </div>

            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              <FromLink
                href={`/dashboard/classes/${group.id}?tab=students`}
                className="inline-flex h-control items-center justify-center rounded-sm bg-surface px-3.5 text-control shadow-card hover:bg-surface-muted"
              >
                {t('classes.cards.students')}
              </FromLink>
              {canManage && state === 'noInstructor' && (
                <FromLink
                  href={`/dashboard/classes/${group.id}`}
                  className="inline-flex h-control items-center justify-center px-2 text-control text-primary underline-offset-4 hover:underline"
                >
                  {t('classes.cards.assignInstructor')}
                </FromLink>
              )}
            </div>
          </section>
        );
  };

  return (
    <div className="grid grid-cols-1 gap-page-gap md:grid-cols-2 xl:grid-cols-3">
      {sets.map((set) => {
        if (set.length === 1) return card(set[0]!);
        const unflagged = set.filter((group) => group.instructorMembershipId === null).length;
        const needing = set.reduce((sum, group) => sum + (flagged[group.id] ?? 0), 0);
        const students = set.reduce(
          (sum, group) => sum + group.students.filter((s) => s.status === 'active').length,
          0,
        );
        const slots = set.reduce((sum, group) => sum + group.schedules.length, 0);
        const summary = [
          t('classes.cards.sameName.summary', { turmas: set.length, slots, students }),
          unflagged > 0 ? t('classes.cards.sameName.noInstructor', { count: unflagged }) : null,
        ]
          .filter((part) => part !== null)
          .join(' · ');
        return (
          <details
            key={`set-${set[0]!.id}`}
            className={cn('group col-span-full rounded bg-surface shadow-card', needing > 0 && attentionClass(flaggedHere))}
          >
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 rounded px-4 py-3 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 text-foreground-muted transition-transform group-open:rotate-90" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="flex shrink-0 items-center gap-2 font-heading text-[15px] font-semibold">
                  {baseName(set[0]!.name)}
                  <AttentionDot count={needing} label={t('classes.cards.state.noInstructor')} />
                </span>
                <span className="truncate text-sm text-foreground-muted">{summary}</span>
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-border p-4">
              {/* Juntar turmas (Rui, 14-11-2026): when some of these are really the same students. */}
              {canManage && (
                <div className="flex justify-end">
                  <JoinTurmas
                    baseName={baseName(set[0]!.name)}
                    turmas={set.map((group) => ({
                      id: group.id,
                      name: group.name,
                      schedule: scheduleOf(group) || t('classes.cards.noSchedule'),
                      students: group.students.filter((s) => s.status === 'active').length,
                    }))}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 gap-page-gap md:grid-cols-2 xl:grid-cols-3">{set.map(card)}</div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
