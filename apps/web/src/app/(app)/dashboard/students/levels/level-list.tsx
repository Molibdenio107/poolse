'use client';

import { useTranslations } from 'next-intl';
import type { StudentLevel } from '@/lib/api';
import { AgeRangeBadge } from '@/components/age-range';
import { Reorderable } from '@/components/reorderable';
import { reorderLevelsAction } from '../students.actions';
import { ArchiveLevelButton, EditLevelForm } from './level-forms';

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

  const details = (level: StudentLevel): React.ReactNode => (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-3">
      <span className="truncate">{level.name}</span>
      <AgeRangeBadge level={level} />
      <span className="whitespace-nowrap text-sm text-foreground-muted">
        {t('students.count', { count: level.studentCount })}
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
          {details(level)}
          <div className="flex flex-wrap items-center gap-1">
            <EditLevelForm organizationId={organizationId} level={level} />
            <ArchiveLevelButton
              organizationId={organizationId}
              levelId={level.id}
              name={level.name}
              studentCount={level.studentCount}
            />
          </div>
        </>
      )}
    </Reorderable>
  );
}
