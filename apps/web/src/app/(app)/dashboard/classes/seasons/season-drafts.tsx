'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { Season } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../../actions';
import { createDraftAction, discardDraftAction, publishSeasonAction } from './drafts.actions';

/**
 * Planning next year while this one runs — POOLSE-45.
 *
 * A club builds the 2026/2027 grid in June, argues about it for three weeks, and
 * switches over in September. For those three weeks both versions have to exist
 * without the draft one showing up on anybody's calendar — which is exactly what
 * a draft is: a season with its own slot grid, from which no dated session is
 * ever generated.
 *
 * **Publishing asks first, and names what it will retire.** It is not the reset
 * — nothing is destroyed and the old season stays readable — but it does change
 * which season every other screen filters by, and that is worth one click of
 * confirmation.
 *
 * **Discarding is a real delete, and the only one in the product.** A draft is a
 * plan nobody acted on: no sessions, no registers, no history. The rule that
 * history is never destroyed is about what happened, not about what somebody
 * considered. A draft holding turmas is refused by the API, because by then it
 * is not a scrap of paper any more.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'h-control rounded border border-border px-4 text-sm hover:bg-surface-muted disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function Failure({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;

  return (
    <p className="w-full text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && state.detail !== '' && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

export function SeasonDrafts({
  organizationId,
  seasons,
  suggested,
}: {
  organizationId: string;
  seasons: Season[];
  /** The name and range the club would open next, from the API. */
  suggested: { name: string; startsOn: string; endsOn: string };
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const published = seasons.find((season) => season.status === 'published');
  const drafts = seasons.filter((season) => season.status === 'draft');

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('seasons.planning')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">{t('seasons.planningHint')}</p>
      </div>

      {drafts.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {drafts.map((draft) => (
            <li key={draft.id} className="py-3 first:pt-0 last:pb-0">
              <DraftRow organizationId={organizationId} draft={draft} />
            </li>
          ))}
        </ul>
      )}

      {/*
        Folded away, because opening a draft is a once-a-year action on a screen
        somebody visits to read which season is running.
      */}
      <div className="rounded border border-dashed border-border">
        <button
          type="button"
          onClick={() => setOpen((shown) => !shown)}
          aria-expanded={open}
          aria-controls="new-draft"
          className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronRight
            aria-hidden
            className={cn('size-4 transition-transform', open && 'rotate-90')}
          />
          {t('seasons.newDraft')}
        </button>

        {open && (
          <div id="new-draft" className="border-t border-border p-4">
            <DraftForm
              organizationId={organizationId}
              suggested={suggested}
              published={published}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One draft, with the two things you do to it.
 *
 * Publishing is behind a confirmation because it changes which season every
 * other screen filters by; discarding is behind one because it is the only real
 * delete in the product.
 */
function DraftRow({
  organizationId,
  draft,
}: {
  organizationId: string;
  draft: Season;
}): React.ReactElement {
  const t = useTranslations();
  const [asking, setAsking] = useState<'publish' | 'discard' | null>(null);
  const [publishState, publish, publishing] = useSavedAction(publishSeasonAction, INITIAL);
  const [discardState, discard, discarding] = useSavedAction(discardDraftAction, INITIAL);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col">
          <span className="flex items-center gap-2 font-medium">
            {draft.name}
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-normal text-foreground-muted">
              {t('seasons.draft')}
            </span>
          </span>
          <span className="text-sm text-foreground-muted">
            {t('seasons.countClasses', { count: draft.classGroups })}
          </span>
        </div>

        {asking === null && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setAsking('publish')}
              className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('seasons.publish')}
            </button>
            <button
              type="button"
              onClick={() => setAsking('discard')}
              aria-label={t('seasons.discardLabel', { name: draft.name })}
              className="rounded text-foreground-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>

      {asking === 'publish' && (
        <form action={publish} className="flex flex-wrap items-center gap-3 rounded border border-primary/40 bg-primary/5 p-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="seasonId" value={draft.id} />
          <p className="text-sm">{t('seasons.confirmPublish', { name: draft.name })}</p>
          <button type="submit" disabled={publishing} className={BUTTON}>
            {publishing ? t('common.working') : t('seasons.publish')}
          </button>
          <button type="button" onClick={() => setAsking(null)} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </form>
      )}

      {asking === 'discard' && (
        <form action={discard} className="flex flex-wrap items-center gap-3 rounded border border-danger/40 bg-danger/5 p-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="seasonId" value={draft.id} />
          <p className="text-sm">{t('seasons.confirmDiscard', { name: draft.name })}</p>
          <button type="submit" disabled={discarding} className={BUTTON}>
            {discarding ? t('common.working') : t('seasons.discard')}
          </button>
          <button type="button" onClick={() => setAsking(null)} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </form>
      )}

      <Failure state={publishState} />
      <Failure state={discardState} />
    </div>
  );
}

/**
 * Opening a draft, with or without a copy of the grid.
 *
 * The copy is a checkbox rather than two buttons, because "duplicate this
 * season" and "start empty" are the same action with one thing different, and
 * two buttons would be two things to explain.
 */
function DraftForm({
  organizationId,
  suggested,
  published,
}: {
  organizationId: string;
  suggested: { name: string; startsOn: string; endsOn: string };
  published: Season | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createDraftAction, INITIAL);
  const [copy, setCopy] = useState(true);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input
        type="hidden"
        name="copyFrom"
        value={copy && published !== undefined ? published.id : ''}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className={cn(FIELD_COLUMN, 'sm:w-48')}>
          <label htmlFor="draft-name" className={FIELD_LABEL}>
            {t('seasons.name')}
          </label>
          <input
            id="draft-name"
            name="name"
            required
            maxLength={60}
            defaultValue={suggested.name}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-40')}>
          <label htmlFor="draft-from" className={FIELD_LABEL}>
            {t('seasons.startsOn')}
          </label>
          <input
            id="draft-from"
            name="startsOn"
            type="date"
            required
            defaultValue={suggested.startsOn}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-40')}>
          <label htmlFor="draft-to" className={FIELD_LABEL}>
            {t('seasons.endsOn')}
          </label>
          <input
            id="draft-to"
            name="endsOn"
            type="date"
            required
            defaultValue={suggested.endsOn}
            className={CONTROL_LINE}
          />
        </div>
      </div>

      {published !== undefined && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={copy}
            onChange={(event) => setCopy(event.target.checked)}
            className="mt-0.5 size-4 accent-[rgb(var(--primary))]"
          />
          <span>
            {t('seasons.copyGrid', { name: published.name })}
            {/*
              What is copied and what is not, said before the button rather than
              discovered afterwards: an operator expecting last year's turmas to
              come with the grid would think the copy had half failed.
            */}
            <span className="mt-0.5 block text-foreground-muted">
              {t('seasons.copyGridHint')}
            </span>
          </span>
        </label>
      )}

      <Failure state={state} />

      <button type="submit" disabled={pending} className={cn(BUTTON, 'self-start')}>
        {pending ? t('common.working') : t('seasons.createDraft')}
      </button>
    </form>
  );
}
