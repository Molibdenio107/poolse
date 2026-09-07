'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Copy, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { CONTROL_LINE } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import {
  readLessonPlanAction,
  saveLessonPlanAction,
  type PlanState,
} from './lesson-plan.actions';

/**
 * The plan for one lesson — round 6, ticket 4.3.
 *
 * A sheet down the side rather than a page: an instructor writing Tuesday's plan
 * is looking at Tuesday, and taking the week off the screen to type four lines
 * would be the wrong trade. The same `Dialog` as the cancel confirmation, in its
 * `side` placement — one portal, one Escape key, one focus round trip.
 *
 * **The API decides who may type, and says so.** `canEdit` comes back with the
 * plan and is the same answer the write guard gives, so a read-only visitor sees
 * the plan as text rather than a box that 403s on Save. Hiding the box is not
 * the permission; the endpoint is.
 *
 * **Explicit Save, not autosave.** A plan is prose somebody is composing, and an
 * autosave writing half a sentence to a colleague's screen is worse than a
 * button. It also keeps "what is stored" a thing the operator decided, which is
 * what makes the "saved by Ana" line trustworthy.
 */

const EMPTY: PlanState = { ok: false, attempt: 0 };

const BUTTON =
  'inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium ' +
  'text-primary-foreground hover:bg-primary/90 disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm ' +
  'hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

export function LessonPlanPanel({
  sessionId,
  onClose,
  actions,
  className,
  facts,
  teacher,
}: {
  /** The lesson being planned, or null when the sheet is shut. */
  sessionId: string | null;
  onClose: () => void;
  /**
   * Take the register and Cancel class, at the foot of the sheet — round 6.
   *
   * They already live on the hover card, and they are here too because this is
   * where somebody ends up when they click a class rather than pass over it.
   * Having opened the lesson, being told to close it and hover the block instead
   * to mark attendance is the kind of thing that makes a feature go unused.
   *
   * A node rather than a shape, for the same reason the hover card takes one:
   * they are a link and a client component the calendar owns, and describing
   * them as data would mean this sheet knowing what a register is.
   */
  actions?: React.ReactNode;
  /**
   * The class this plan belongs to, and the facts about it.
   *
   * A sheet that opens with a date and a text box asks somebody to remember
   * which of the week's blocks they clicked. The name and the same facts the
   * hover card carries — level, pistas, hour, instructor, whether the register
   * is taken — come from one function, so the two never describe the class
   * differently.
   */
  className?: string;
  facts?: { label: string; value: string }[];
  /**
   * Who is teaching this one lesson, placed above Save.
   *
   * Separate from `actions` because of where it goes rather than what it is:
   * the picker writes on change, and sitting under Save it read as something
   * Save would record. Above it, with the plan, it is plainly part of the same
   * screenful.
   */
  teacher?: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();

  const [loaded, load] = useActionState(readLessonPlanAction, EMPTY);
  const [saved, save, saving] = useActionState(saveLessonPlanAction, EMPTY);

  /*
   * The text being edited, controlled — CLAUDE.md's rule, and it bites harder
   * here than anywhere. React 19 resets a form the moment a function action
   * returns, so an uncontrolled textarea would wipe a plan somebody had just
   * spent five minutes writing at the exact moment the save came back.
   */
  const [body, setBody] = useState('');
  const openedFor = useRef<string | null>(null);

  // A newly opened lesson is fetched once. Keyed on the id rather than on the
  // dialog's open flag, so reopening a different class refetches and reopening
  // the same one does not.
  useEffect(() => {
    if (sessionId === null || openedFor.current === sessionId) return;
    openedFor.current = sessionId;
    setBody('');

    const data = new FormData();
    data.set('sessionId', sessionId);
    startTransition(() => load(data));
  }, [sessionId, load]);

  // Whatever the server last said is what the box holds. Both actions return a
  // plan, so a save leaves the text exactly as it was stored rather than as it
  // was typed — which is the difference the trim makes visible.
  const plan = saved.plan ?? loaded.plan;
  const planFor = plan?.sessionId;

  useEffect(() => {
    if (plan === undefined || planFor !== sessionId) return;
    setBody(plan.body);
  }, [plan, planFor, sessionId]);

  const canEdit = plan?.canEdit === true;
  const failure = saved.errorKey ?? loaded.errorKey;

  const append = (line: string): void =>
    setBody((was) => (was.trim() === '' ? line : `${was.replace(/\s+$/, '')}\n${line}`));

  return (
    <Dialog
      open={sessionId !== null}
      onClose={onClose}
      placement="side"
      /*
        Wider than the default sheet — round 6.

        A lesson plan is prose being composed: sets, distances and strokes, one
        line each. At the sheet's usual 28rem a line like "8 x 50 costas com
        prancha, 20\" descanso" wrapped twice, so a plan that is eight lines in
        somebody's head looked like sixteen and was hard to read back. `cn` uses
        tailwind-merge, so this width simply replaces the component's own.
      */
      /*
        A column that fills the sheet, so the plan fits instead of scrolling.

        Everything here has a natural height except the text box, which had a
        22rem floor and pushed Save, the teacher and the two buttons below the
        fold — on a laptop the sheet scrolled before a word was typed. As a
        flex column the fixed parts keep their size and the box absorbs whatever
        is left, which is the one thing here that can honestly be any height.
        `overflow-y-auto` stays on the panel underneath as the honest fallback
        for a genuinely short window.
      */
      className="flex max-w-2xl flex-col"
      title={t('calendar.plan.title')}
      {...(plan === undefined
        ? {}
        : { description: format.dateTime(new Date(`${plan.onDate}T00:00:00`), 'long') })}
      closeLabel={t('common.close')}
    >
      {plan === undefined ? (
        <p className="text-sm text-foreground-muted">{t('common.working')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {failure !== undefined && (
            <p className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {t(failure)}
            </p>
          )}

          {/*
            Which class this is. The date is already the sheet's description, so
            this carries the name and the facts that place it in the week.
          */}
          {(className !== undefined || facts !== undefined) && (
            <div className="rounded border border-border bg-surface-muted p-3">
              {className !== undefined && <p className="font-medium">{className}</p>}
              {facts !== undefined && facts.length > 0 && (
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-foreground-muted">
                  {facts.map((fact) => (
                    <div key={fact.label} className="flex gap-1.5">
                      <dt>{fact.label}:</dt>
                      <dd className="text-foreground">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

          {/*
            A cancelled lesson still has its plan, and says why it is not one to
            work on. Stored either way — a class brought back by Undo comes back
            with what was written for it.
          */}
          {plan.cancelled && (
            <p className="rounded border border-warning/40 bg-warning/5 p-3 text-sm">
              {t('calendar.plan.cancelled')}
            </p>
          )}

          {canEdit ? (
            <>
              {/*
                The skills of the turma's level, one press each.

                Suggestions rather than a checklist: what a club teaches in one
                session is a judgement, and a list that recorded which skills
                were covered would be `skill_progress`, which already exists and
                is about a student rather than a lesson.
              */}
              {plan.skills.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm text-foreground-muted">{t('calendar.plan.suggestions')}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {plan.skills.map((skill) => (
                      <li key={skill}>
                        <button
                          type="button"
                          onClick={() => append(skill)}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          <Plus aria-hidden className="size-3" />
                          {skill}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <label htmlFor="lesson-plan" className="text-sm font-medium">
                  {t('calendar.plan.label')}
                </label>
                <textarea
                  id="lesson-plan"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={6}
                  maxLength={8000}
                  placeholder={t('calendar.plan.placeholder')}
                  /*
                    The box takes whatever the sheet has left.
                    
                    `rows` is only the floor for a window too short to give it
                    anything; `flex-1` with `min-h-0` is what actually sizes it,
                    and `min-h-0` is the half that matters — without it a flex
                    item refuses to shrink below its content and the sheet
                    scrolls anyway. A long plan scrolls inside the box, which is
                    what a text box is for, rather than pushing Save off-screen.
                  */
                  className={cn(CONTROL_LINE, 'h-auto min-h-0 flex-1 resize-none py-2 leading-relaxed')}
                />
              </div>

              {/*
                The teacher, immediately above Save.

                It saves on change rather than with the form, and under the
                button it read as something the button would record — so
                somebody could choose a stand-in, not press Save, and reasonably
                believe they had lost it. Above the button it is part of what is
                plainly on screen together.
              */}
              {teacher !== undefined && (
                <div className="border-t border-border pt-4">{teacher}</div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={saving || sessionId === null}
                  onClick={() => {
                    if (sessionId === null) return;
                    const data = new FormData();
                    data.set('sessionId', sessionId);
                    data.set('body', body);
                    startTransition(() => save(data));
                  }}
                  className={BUTTON}
                >
                  {saving ? t('common.working') : t('common.save')}
                </button>

                {/*
                  The previous lesson of this turma, copied in — never appended.

                  Replacing rather than adding, because the button says "copy
                  from", and somebody who has already typed something is warned
                  by what they can see: it is disabled once the box differs from
                  nothing, so it cannot silently overwrite five minutes of work.
                */}
                {plan.previous !== null && (
                  <button
                    type="button"
                    disabled={body.trim() !== ''}
                    onClick={() => setBody(plan.previous?.body ?? '')}
                    title={
                      body.trim() === '' ? undefined : t('calendar.plan.copyBlockedHint')
                    }
                    className={BUTTON_QUIET}
                  >
                    <Copy aria-hidden className="size-3.5" />
                    {t('calendar.plan.copyPrevious', {
                      date: format.dateTime(
                        new Date(`${plan.previous.onDate}T00:00:00`),
                        'short',
                      ),
                    })}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-foreground-muted">{t('calendar.plan.readOnly')}</p>
              {plan.body === '' ? (
                <p className="text-sm text-foreground-muted">{t('calendar.plan.none')}</p>
              ) : (
                // `whitespace-pre-wrap`, because the plan is lines. Rendering it
                // as a paragraph would run the drills together into prose. It
                // takes the sheet's spare height and scrolls inside itself, so a
                // long plan does not push the buttons under it off-screen.
                <p className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-surface-muted p-3 text-sm">
                  {plan.body}
                </p>
              )}
            </>
          )}

          {plan.updatedAt !== null && (
            <p className="text-sm text-foreground-muted">
              {t('calendar.plan.lastSaved', {
                who: plan.updatedBy ?? t('calendar.plan.someone'),
                // A moment rather than a day: "guardado a 11/09/26, 21:04"
                // without the clock is a sentence that answers the wrong
                // question.
                when: format.dateTime(new Date(plan.updatedAt), 'stamp'),
              })}
            </p>
          )}

          {actions !== undefined && (
            <div className="border-t border-border pt-4">{actions}</div>
          )}
        </div>
      )}
    </Dialog>
  );
}
