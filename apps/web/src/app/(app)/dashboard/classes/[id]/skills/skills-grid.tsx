'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { TurmaSkills } from '@/lib/api';
import { SKILL_STATES, type SkillState } from '@/lib/skills';
import { SkillLegend, SkillStateCell, SkillStateChip } from '@/components/skill-state';
import { cn } from '@/lib/utils';
import { markSkillsAction } from './skills.actions';

/**
 * The instructor's grid — POOLSE-20, criteria 4 and 5.
 *
 * Students down, skills across, because that is the shape of the question being
 * asked at the poolside: "who has got this yet" reads down a column, "how is
 * this child doing" reads along a row.
 *
 * **The two bulk gestures are the point.** Tapping a column header marks that
 * one skill across the whole turma — which is how assessment actually happens,
 * one skill at a time with twelve children in the water. Tapping a row does one
 * student across everything, for the child who was away and is being caught up.
 * Both are one request, so a dropped connection cannot leave half a column
 * marked.
 *
 * **Nothing is lost when the connection goes.** Every tap paints immediately and
 * the save happens after; a failed save rolls that cell back and says so, rather
 * than leaving the grid claiming something the server never accepted. There is
 * no "save" button, because a button is a thing to forget with wet hands.
 *
 * **Sign-off is the only state with a gate.** Iniciado and Avaliado are
 * observations about what is happening in the water and nothing should slow them
 * down. Adquirido is a judgement that carries weight, so where a skill has
 * thresholds and they are not met, the grid asks for a reason and records who
 * gave it.
 */

/** Tapping a cell walks forward through the states and wraps. */
function nextState(current: SkillState): SkillState {
  const at = SKILL_STATES.indexOf(current);
  return SKILL_STATES[(at + 1) % SKILL_STATES.length]!;
}

type Key = string;
const keyOf = (studentId: string, skillId: string): Key => `${studentId}:${skillId}`;

export function SkillsGrid({ data }: { data: TurmaSkills }): React.ReactElement {
  const t = useTranslations();
  const [, startTransition] = useTransition();

  // The grid's own copy. The server's answer seeds it; every tap moves it
  // immediately, and a refused save moves it back.
  const [marks, setMarks] = useState(() => {
    const map = new Map<Key, { state: SkillState; ready: boolean; overridden: boolean }>();
    for (const mark of data.marks) {
      map.set(keyOf(mark.studentId, mark.skillId), {
        state: mark.state,
        ready: mark.ready,
        overridden: mark.overridden,
      });
    }
    return map;
  });

  const [failed, setFailed] = useState<string | null>(null);
  const [asking, setAsking] = useState<
    { cells: { studentId: string; skillId: string }[]; label: string } | null
  >(null);

  const cell = useCallback(
    (studentId: string, skillId: string) =>
      marks.get(keyOf(studentId, skillId)) ?? {
        state: 'not_started' as SkillState,
        ready: true,
        overridden: false,
      },
    [marks],
  );

  /**
   * Sends a set of cells, having already painted them.
   *
   * `needsOverride` comes back naming the pairings the thresholds refused; those
   * are rolled back and put to the instructor as one question rather than as one
   * question per child.
   */
  const send = useCallback(
    (
      cells: { studentId: string; skillId: string; state: SkillState }[],
      overrideReason?: string,
    ) => {
      const before = new Map(marks);

      setMarks((current) => {
        const next = new Map(current);
        for (const c of cells) {
          const existing = next.get(keyOf(c.studentId, c.skillId));
          next.set(keyOf(c.studentId, c.skillId), {
            state: c.state,
            ready: existing?.ready ?? true,
            overridden: overrideReason !== undefined ? true : (existing?.overridden ?? false),
          });
        }
        return next;
      });

      setFailed(null);

      startTransition(() => {
        void markSkillsAction(
          data.classGroupId,
          cells.map((c) => ({ ...c, overrideReason: overrideReason ?? null })),
        ).then((outcome) => {
          if (outcome === null) {
            // The request itself failed. Put everything back — a grid that keeps
            // a change the server never saw is worse than one that visibly
            // refused it.
            setMarks(before);
            setFailed(t('skills.saveFailed'));
            return;
          }

          if (outcome.needsOverride.length === 0) return;

          // Roll back only the refused cells, and ask about them together.
          setMarks((current) => {
            const next = new Map(current);
            for (const refused of outcome.needsOverride) {
              const was = before.get(keyOf(refused.studentId, refused.skillId));
              if (was === undefined) next.delete(keyOf(refused.studentId, refused.skillId));
              else next.set(keyOf(refused.studentId, refused.skillId), was);
            }
            return next;
          });

          setAsking({
            cells: outcome.needsOverride,
            label: t('skills.overrideCount', { count: outcome.needsOverride.length }),
          });
        });
      });
    },
    [data.classGroupId, marks, t],
  );

  const tapCell = (studentId: string, skillId: string): void => {
    send([{ studentId, skillId, state: nextState(cell(studentId, skillId).state) }]);
  };

  /**
   * A whole column, to one state.
   *
   * Not "advance each by one": a column of children at four different stages
   * would scatter further apart, which is the opposite of what the gesture is
   * for. It sets them all to the same thing — whatever the column is least far
   * along, moved on one — so the gesture means "we did this today".
   */
  const tapColumn = (skillId: string): void => {
    const lowest = data.students.reduce<number>(
      (low, student) => Math.min(low, SKILL_STATES.indexOf(cell(student.id, skillId).state)),
      SKILL_STATES.length - 1,
    );
    const target = SKILL_STATES[Math.min(lowest + 1, SKILL_STATES.length - 1)]!;

    send(data.students.map((student) => ({ studentId: student.id, skillId, state: target })));
  };

  const tapRow = (studentId: string): void => {
    const lowest = data.skills.reduce<number>(
      (low, skill) => Math.min(low, SKILL_STATES.indexOf(cell(studentId, skill.id).state)),
      SKILL_STATES.length - 1,
    );
    const target = SKILL_STATES[Math.min(lowest + 1, SKILL_STATES.length - 1)]!;

    send(data.skills.map((skill) => ({ studentId, skillId: skill.id, state: target })));
  };

  const skillById = useMemo(
    () => new Map(data.skills.map((skill) => [skill.id, skill])),
    [data.skills],
  );

  if (data.skills.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
        <p>{t('skills.noSkills')}</p>
        <p className="text-sm text-foreground-muted">{t('skills.noSkillsHint')}</p>
      </section>
    );
  }

  if (data.students.length === 0) {
    return (
      <section className="rounded border border-border bg-surface p-5">
        <p className="text-foreground-muted">{t('classes.noStudents')}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
        <SkillLegend />
        <p className="text-sm text-foreground-muted">{t('skills.gridHint')}</p>
        {failed !== null && <p className="text-sm text-danger">{failed}</p>}
      </div>

      {/*
        The only horizontal scroll in the app, and it is the right call here: a
        turma of twenty skills cannot fit a phone, and stacking the grid into
        cards would lose the column — which is the whole gesture. The scroll is
        inside its own container so the page itself never scrolls sideways.
      */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-40 bg-background p-2 text-left font-medium"
              >
                {t('skills.student')}
              </th>
              {data.skills.map((skill) => (
                <th key={skill.id} scope="col" className="p-1 align-bottom">
                  <button
                    type="button"
                    onClick={() => tapColumn(skill.id)}
                    title={thresholdHint(skill, t)}
                    className="flex h-32 w-12 items-end justify-center rounded p-1 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    {/*
                      Vertical, so twenty skills fit a screen. `writing-mode` with
                      a rotation reads bottom-to-top, which is the convention for
                      column labels in a dense table.
                    */}
                    <span
                      className="whitespace-nowrap text-left [writing-mode:vertical-rl]"
                      style={{ transform: 'rotate(180deg)' }}
                    >
                      {skill.name}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {data.students.map((student) => (
              <tr key={student.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-t border-border bg-background p-0 text-left font-normal"
                >
                  <button
                    type="button"
                    onClick={() => tapRow(student.id)}
                    className="w-full truncate rounded p-2 text-left hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    {student.name}
                  </button>
                </th>

                {data.skills.map((skill) => {
                  const current = cell(student.id, skill.id);
                  return (
                    <td key={skill.id} className="border-t border-border p-1">
                      <button
                        type="button"
                        onClick={() => tapCell(student.id, skill.id)}
                        aria-label={`${student.name}, ${skill.name}: ${t(
                          `skills.state.${current.state}`,
                        )}`}
                        className="size-10 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                      >
                        <SkillStateCell
                          state={current.state}
                          ready={current.ready}
                          overridden={current.overridden}
                        />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {asking !== null && (
        <OverrideDialog
          label={asking.label}
          names={asking.cells.map((c) => {
            const student = data.students.find((s) => s.id === c.studentId);
            const skill = skillById.get(c.skillId);
            return `${student?.name ?? ''} · ${skill?.name ?? ''}`;
          })}
          onCancel={() => setAsking(null)}
          onConfirm={(reason) => {
            send(
              asking.cells.map((c) => ({ ...c, state: 'attained' as SkillState })),
              reason,
            );
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}

/** "Pelo menos 3 aulas e 7 dias" — shown on the column header. */
function thresholdHint(
  skill: { minDays: number | null; minLessons: number | null },
  t: ReturnType<typeof useTranslations>,
): string | undefined {
  const parts: string[] = [];
  if (skill.minLessons !== null) parts.push(t('skills.minLessons', { count: skill.minLessons }));
  if (skill.minDays !== null) parts.push(t('skills.minDays', { count: skill.minDays }));
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/**
 * Asking for a reason to sign off early — criterion 2.
 *
 * One question for the whole gesture, not one per child: an instructor who marked
 * a column of twelve and had three refused is making one decision about those
 * three, and three dialogs would be three chances to give up.
 *
 * The names are listed, because "3 alunos" is not enough to decide with.
 */
function OverrideDialog({
  label,
  names,
  onCancel,
  onConfirm,
}: {
  label: string;
  names: string[];
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}): React.ReactElement {
  const t = useTranslations();
  const [reason, setReason] = useState('');

  return (
    <section className="flex flex-col gap-3 rounded border border-warning/40 bg-warning/10 p-5">
      <h2 className="font-medium">{label}</h2>
      <p className="text-sm">{t('skills.overrideHint')}</p>

      <ul className="flex list-inside list-disc flex-col gap-0.5 text-sm text-foreground-muted">
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-foreground-muted">{t('skills.overrideReason')}</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          placeholder={t('skills.overrideReasonPlaceholder')}
          className="rounded border border-border bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={reason.trim() === ''}
          onClick={() => onConfirm(reason.trim())}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {t('skills.overrideConfirm')}
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-border px-4 py-2">
          {t('common.cancel')}
        </button>
      </div>
    </section>
  );
}

export { SkillStateChip };
