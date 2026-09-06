'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Plus } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { timeAgo } from '@/lib/relative-time';
import { withFrom } from '@/lib/back';
import type { Space, SpaceType } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../actions';
import { createSpace } from './spaces.actions';

/**
 * Espaços — the parts of a site that are not tanks. Round 6.
 *
 * A facility has always had Piscinas; it has never had the balneários, the sala
 * de máquinas, the arrecadação or the car park, which is where most of the work
 * of running a pool actually happens.
 *
 * **It appears twice, from one component.** On Instalações it sits inside each
 * site's card directly under that site's tanks; on the site's own page it is a
 * section like the others. Same data, same controls, two presentations — because
 * a bordered card nested inside a bordered card reads as a different kind of
 * thing, while a bare block floating on the page reads as unfinished.
 *
 * `variant` is the only difference, and it is deliberately the *only* difference:
 * a second copy of this panel is how the two screens start disagreeing about what
 * a space is.
 *
 * **The row is the summary and the link.** Name, type, when it was last cleaned
 * and how many issues are open — the four things somebody wants before deciding
 * whether to open it. The name is the link, with no "ver detalhes" beside it,
 * matching the Piscinas list directly above and the Instalações list before that.
 */

const INITIAL: FormState = { ok: false };

export const SPACE_TYPES: readonly SpaceType[] = [
  'changing_room',
  'technical',
  'storage',
  'reception',
  'outdoor',
  'other',
];

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The overdue marker.
 *
 * Icon *and* words, never colour alone — a red row says nothing to somebody who
 * cannot distinguish it from the row above, and this is the one piece of
 * information on the list that an operator is meant to act on. The colour is
 * there as well, because for everybody else it is the fastest possible read.
 */
function OverdueBadge({ label }: { label: string }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">
      <AlertTriangle className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

export function SpacesPanel({
  facilityId,
  spaces,
  canManage,
  variant = 'card',
}: {
  facilityId: string;
  spaces: Space[];
  canManage: boolean;
  /** `block` sits inside a site card on Instalações; `card` stands alone. */
  variant?: 'card' | 'block';
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [adding, setAdding] = useState(false);

  const [state, dispatch, pending] = useSavedAction<FormState, FormData>(
    createSpace.bind(null, facilityId),
    INITIAL,
  );

  // Closing on success rather than on submit: a refused name must leave the
  // dialog open with what somebody typed still in it.
  if (state.ok && adding) setAdding(false);

  const block = variant === 'block';
  const Wrapper = block ? 'div' : 'section';
  const Heading = block ? 'h3' : 'h2';

  return (
    <Wrapper
      className={cn(
        'flex flex-col',
        block
          ? 'gap-3 border-t border-border pt-4'
          : 'gap-4 rounded border border-border bg-surface p-5',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading
          className={cn(
            'text-sm text-foreground-muted',
            !block && 'font-medium uppercase tracking-wider',
          )}
        >
          {t('spaces.title')}
        </Heading>

        {canManage && (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
            <Plus className="size-4" aria-hidden="true" />
            {t('spaces.add')}
          </button>
        )}
      </div>

      {spaces.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('spaces.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {spaces.map((space) => {
            const ago = timeAgo(space.lastCleanedAt, locale);

            return (
              <li key={space.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Link
                    href={withFrom(
                      `/dashboard/facilities/spaces/${space.id}`,
                      `/dashboard/facilities/${facilityId}`,
                    )}
                    className="rounded font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {space.name}
                  </Link>

                  <span className="text-sm text-foreground-muted">
                    {t(`spaces.type.${space.type}`)}
                  </span>

                  {/*
                    Out of service is said in words next to the name, because it
                    is the reason the row shows no overdue warning. Without it a
                    closed balneário and a spotless one look identical.
                  */}
                  {!space.active && (
                    <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-xs text-foreground-muted">
                      {t('spaces.inactive')}
                    </span>
                  )}

                  {space.overdue && <OverdueBadge label={t('spaces.overdue')} />}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-muted">
                  {/*
                    "Nunca limpo" rather than an empty cell. A blank space on the
                    row where a date belongs reads as a page that failed to load,
                    and the answer here is a real and important one.
                  */}
                  <span className={cn(space.overdue && 'text-danger')}>
                    {ago === null ? t('spaces.neverCleaned') : t('spaces.cleanedAgo', { ago })}
                  </span>

                  {space.openIssues > 0 && (
                    <span>{t('spaces.openIssues', { count: space.openIssues })}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('spaces.add')}
        closeLabel={t('common.close')}
      >
        <form action={dispatch} className="flex flex-col gap-4">
          <TextField
            name="name"
            label={t('spaces.name')}
            required
            {...(state.fields?.name === undefined ? {} : { error: t(state.fields.name) })}
          />

          <SelectField
            name="type"
            label={t('spaces.typeLabel')}
            initial="other"
            options={SPACE_TYPES.map((type) => ({
              value: type,
              label: t(`spaces.type.${type}`),
            }))}
            {...(state.fields?.type === undefined ? {} : { error: t(state.fields.type) })}
          />

          <TextField
            name="intervalHours"
            label={t('spaces.interval')}
            inputMode="numeric"
            hint={t('spaces.intervalHint')}
            {...(state.fields?.intervalHours === undefined
              ? {}
              : { error: t(state.fields.intervalHours) })}
          />

          <TextAreaField name="description" label={t('spaces.description')} rows={2} />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked className="size-4" />
            {t('spaces.activeLabel')}
          </label>

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">{t(state.errorKey)}</p>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className={BUTTON}>
              {pending ? t('common.working') : t('common.save')}
            </button>
            <button type="button" onClick={() => setAdding(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </Wrapper>
  );
}
