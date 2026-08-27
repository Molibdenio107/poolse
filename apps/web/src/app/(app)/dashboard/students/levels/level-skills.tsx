'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Video, X } from 'lucide-react';
import type { Skill } from '@/lib/api';
import { TextField } from '@/components/ui/field';
import { Reorderable } from '@/components/reorderable';
import { ScrollX } from '@/components/page-shell';
import type { FormState } from '../../actions';
import {
  archiveSkillAction,
  createSkillAction,
  reorderSkillsAction,
  skillsOfAction,
} from '../students.actions';

/**
 * What a level consists of — POOLSE-20.
 *
 * Folded away behind a disclosure, one per level. Most visits to this page are
 * about the levels themselves; a club sets up its skills once a season and then
 * leaves them alone, so they should not be in the way of renaming a level.
 *
 * Loaded when opened rather than with the page, for the same reason: fetching
 * every skill of every level to render a screen that usually shows none of them
 * is work nobody asked for.
 *
 * **The thresholds are optional and stay optional.** A club that does not work
 * that way leaves both blank and never sees them again. Where they are set, they
 * are what stops a skill being signed off the first day it is tried — the
 * failure they exist to prevent, and one no amount of training reliably fixes on
 * a busy poolside.
 */

const INITIAL: FormState = { ok: false };

export function LevelSkills({
  organizationId,
  levelId,
  canManage,
}: {
  organizationId: string;
  levelId: string;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [state, action, saving] = useActionState(createSkillAction, INITIAL);

  // Re-read when opened, and again after a save — `state` changes identity on
  // every submission, which is what makes the new skill appear.
  useEffect(() => {
    if (!open) return;
    void skillsOfAction(levelId).then(setSkills);
  }, [open, levelId, state]);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {open ? (
          <ChevronDown className="size-4" aria-hidden />
        ) : (
          <ChevronRight className="size-4" aria-hidden />
        )}
        {skills === null
          ? t('skills.title')
          : t('skills.count', { count: skills.length })}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded border border-border bg-surface-muted p-3">
          {skills === null ? (
            <p className="text-sm text-foreground-muted">{t('common.working')}</p>
          ) : skills.length === 0 ? (
            /* A purposeful empty state, not a blank table — AC6. */
            <div className="flex flex-col items-start gap-2 rounded border border-dashed border-border p-4">
              <p className="text-sm">{t('skills.noneYet')}</p>
              <p className="text-sm text-foreground-muted">{t('skills.noneYetHint')}</p>
            </div>
          ) : (
            /*
             * A table with aligned columns — AC1.
             *
             * The content was already right; stacked text was what made a level
             * hard to scan exactly when somebody was comparing skills. Headers
             * stay visible while it is open, and the two numeric columns are
             * right-aligned with tabular figures so they compare downwards.
             *
             * `Reorderable` renders the rows, so dragging a skill uses the same
             * interaction as dragging a level — one pattern at two depths, per
             * AC7. Its drag handlers live only on the grip, so a row drag can
             * never pick up the card it sits in.
             */
            <ScrollX>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="w-10 px-2 py-2">
                      <span className="sr-only">{t('skills.reorder')}</span>
                    </th>
                    <th scope="col" className="w-8 px-1 py-2 text-right font-medium text-foreground-muted">
                      #
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-foreground-muted">
                      {t('skills.skillName')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-foreground-muted">
                      {t('skills.minLessonsLabel')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-foreground-muted">
                      {t('skills.minDaysLabel')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-foreground-muted">
                      {t('skills.video')}
                    </th>
                    <th scope="col" className="w-10 px-2 py-2">
                      <span className="sr-only">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>

                <Reorderable
                  as="rows"
                  columns={7}
                  items={skills.map((skill) => ({ id: skill.id, label: skill.name, skill }))}
                  onReorder={async (ids) => {
                    await reorderSkillsAction(organizationId, levelId, ids);
                  }}
                >
                  {(row) => (
                    <>
                      <td className="px-3 py-2">{row.skill.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.skill.minLessons ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.skill.minDays ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {/* Icon and label, never colour alone — 40.12. */}
                        {row.skill.videoUrl === null ? (
                          <span className="text-foreground-muted">{t('skills.noVideo')}</span>
                        ) : (
                          <a
                            href={row.skill.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            <Video className="size-4" aria-hidden />
                            {t('skills.hasVideo')}
                          </a>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {canManage && (
                          <RemoveSkill
                            organizationId={organizationId}
                            skillId={row.skill.id}
                            name={row.skill.name}
                          />
                        )}
                      </td>
                    </>
                  )}
                </Reorderable>
              </table>
            </ScrollX>
          )}

          {canManage && (
            <form action={action} className="flex flex-col gap-3 border-t border-border pt-3">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="levelId" value={levelId} />

              <div className="flex flex-wrap items-end gap-3">
                <TextField
                  name="name"
                  label={t('skills.skillName')}
                  placeholder={t('skills.skillNamePlaceholder')}
                  required
                  maxLength={120}
                  error={state.fields?.['name'] === undefined ? undefined : t(state.fields['name'])}
                  className="min-w-48 flex-1"
                />
                <TextField
                  name="minLessons"
                  type="number"
                  label={t('skills.minLessonsLabel')}
                  hint={t('students.optionalHint')}
                  className="w-28"
                />
                <TextField
                  name="minDays"
                  type="number"
                  label={t('skills.minDaysLabel')}
                  hint={t('students.optionalHint')}
                  className="w-28"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                >
                  {saving ? t('common.working') : t('skills.addSkill')}
                </button>
              </div>

              <TextField
                name="videoUrl"
                type="url"
                label={t('skills.videoUrl')}
                hint={t('skills.videoUrlHint')}
                maxLength={500}
              />

              {state.errorKey !== undefined && (
                <p className="text-sm text-danger">{t(state.errorKey)}</p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function RemoveSkill({
  organizationId,
  skillId,
  name,
}: {
  organizationId: string;
  skillId: string;
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useActionState(archiveSkillAction, INITIAL);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="skillId" value={skillId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('skills.removeSkill', { name })}
        className="rounded p-1 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      >
        <X className="size-4" aria-hidden />
      </button>
    </form>
  );
}
