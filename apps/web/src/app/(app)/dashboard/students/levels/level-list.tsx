'use client';

import { useTranslations } from 'next-intl';
import type { StudentLevel } from '@/lib/api';
import { AgeRangeBadge } from '@/components/age-range';
import { Reorderable } from '@/components/reorderable';
import { reorderLevelsAction } from '../students.actions';
import { ArchiveLevelButton, EditLevelForm } from './level-forms';
import { LevelSkills } from './level-skills';

/**
 * The progression, reorderable — POOLSE-05.
 *
 * The up/down arrows are gone. They were two buttons per row that did one hop
 * each, so moving a level from fifth to first was four clicks and four writes;
 * dragging is one of each. What replaces them is a grip that works by pointer,
 * by finger and by keyboard, which is more ways to reorder than the arrows
 * offered, not fewer.
 *
 * A client component because the order is held optimistically while the save is
 * in flight — the list has to move under the pointer before the server has
 * agreed, or dragging feels broken.
 */
export function LevelList({
  organizationId,
  levels,
  canManage,
}: {
  organizationId: string;
  levels: StudentLevel[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();

  /**
   * Name on its own line, detail under it — round 4.
   *
   * These three were one wrapping row of equal-weight text, so "Iniciação 2",
   * "3–5 anos" and "12 alunos" read as three sibling facts and, at the width the
   * drag grip and two buttons leave, wrapped into an arbitrary shape that
   * differed per row. The eye had nothing to run down.
   *
   * The name is what identifies the level, so it is the line; the range and the
   * count describe it, so they sit beneath in muted text at a fixed order. Every
   * row is now the same two lines whatever the viewport does, which is what makes
   * a list of eight scannable.
   */
  const details = (level: StudentLevel): React.ReactNode => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="truncate font-medium">{level.name}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AgeRangeBadge level={level} />
        <span className="whitespace-nowrap text-sm text-foreground-muted">
          {t('students.count', { count: level.studentCount })}
        </span>
      </span>
    </div>
  );

  // Nothing to reorder without the right to change anything, and a grip that
  // moved a list back on every save would be worse than no grip.
  if (!canManage) {
    return (
      <ol className="flex flex-col divide-y divide-border">
        {levels.map((level, index) => (
          <li
            key={level.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <span className="text-sm text-foreground-muted">{index + 1}.</span>
            {details(level)}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <Reorderable
      items={levels.map((level) => ({ ...level, label: level.name }))}
      onReorder={async (ids) => {
        await reorderLevelsAction(organizationId, ids);
      }}
    >
      {(level) => (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {/*
              The actions sit on the name's line rather than beside the whole
              block, so they stay put as the skills panel opens and closes
              underneath. Before, expanding a level dragged its own Edit button
              halfway down the screen.
            */}
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              {details(level)}
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <EditLevelForm organizationId={organizationId} level={level} />
                <ArchiveLevelButton
                  organizationId={organizationId}
                  levelId={level.id}
                  name={level.name}
                  studentCount={level.studentCount}
                />
              </div>
            </div>

            {/* What the level consists of — POOLSE-20. Folded away, because a
                club sets these up once a season and then leaves them alone. */}
            <LevelSkills
              organizationId={organizationId}
              levelId={level.id}
              canManage={canManage}
            />
          </div>
        </>
      )}
    </Reorderable>
  );
}
