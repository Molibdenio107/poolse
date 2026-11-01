import { getTranslations } from 'next-intl/server';
import { Waves, User } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { PageEmpty } from '@/components/page-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { ClassGroup } from '@/lib/api';
import { classColourVar } from '@/lib/calendar-scale';
import { cn } from '@/lib/utils';

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
const TONE: Record<State, BadgeTone> = { open: 'ok', full: 'pending', noInstructor: 'late' };

export async function TurmaCards({
  groups,
  canManage,
}: {
  groups: ClassGroup[];
  canManage: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  if (groups.length === 0) {
    return (
      <PageEmpty
        message={t('classes.none')}
        hint={canManage ? t('classes.noneHintManager') : t('classes.noneHintMember')}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-page-gap md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => {
        const active = group.students.filter((s) => s.status === 'active').length;
        const waiting = group.students.filter((s) => s.status === 'waiting').length;
        const full = group.capacity !== null && active >= group.capacity;
        const state: State = group.instructorMembershipId === null ? 'noInstructor' : full ? 'full' : 'open';
        const colour = classColourVar(group.colour);
        const schedule = [...group.schedules]
          .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
          .map((slot) => `${t(`weekShort.${slot.weekday}`)} ${slot.startTime}`)
          .join(' · ');
        return (
          <section
            key={group.id}
            className={cn(
              'flex flex-col gap-3 rounded bg-surface p-5 shadow-card',
              state === 'noInstructor' && 'outline outline-2 outline-warning/50',
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
      })}
    </div>
  );
}
