'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSavedAction } from '@/lib/saved';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import type { LostAndFoundItem } from '@/lib/api';
import type { FormState } from '../../actions';
import {
  recordFoundAction,
  removeFoundAction,
  returnFoundAction,
} from './lost-and-found.actions';

/**
 * Lost property — round 5, ticket 6.1.
 *
 * **Collapsed by default**, as the ticket asks, and the reason is worth stating:
 * the store room is what an operator opens this page for. Lost property is
 * something they come to occasionally, and an expanded card of towels would push
 * the inventory below the fold every time.
 *
 * The inputs mirror the store room's — a description, a place, a date, notes —
 * plus the one thing an inventory item never has: whose it is. Attaching a
 * student stamps that they were told, which is the record the mobile app will
 * read when the notifications subsystem lands in phase 3.
 *
 * There is no photo control. The inventory has none either; file storage is
 * deferred, and a disabled button explaining why belongs on the day the other
 * three photo controls get one.
 */

const INITIAL: FormState = { ok: true };

const BUTTON =
  'inline-flex h-control items-center gap-2 rounded bg-primary px-4 text-sm ' +
  'text-primary-foreground disabled:opacity-60 focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const LINK =
  'rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

export function LostAndFoundPanel({
  facilityId,
  items,
  students,
  locations,
  canManage,
}: {
  facilityId: string;
  items: LostAndFoundItem[];
  /** This site's students, for the picker. A short list; a club, not a country. */
  students: { id: string; name: string }[];
  /** The same place names the store room suggests — one vocabulary. */
  locations: string[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const outstanding = items.filter((item) => item.status === 'found').length;

  return (
    <section className="rounded border border-border bg-surface">
      {/*
        The heading is the toggle. `aria-expanded` and a real button rather than
        a clickable div, so it is reachable and announced; the chevron turns
        rather than swapping icons, which is one fewer thing to keep in step.
      */}
      <h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="lost-and-found-body"
          className="flex w-full items-center justify-between gap-3 p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <span className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('inventory.lostAndFound.title')}
            {/*
              The count is the reason to open it, so it is on the closed header.
              Text, not a coloured dot: colour never carries meaning alone.
            */}
            {outstanding > 0 && (
              <span className="ml-2 normal-case tracking-normal text-foreground">
                {t('inventory.lostAndFound.outstanding', { count: outstanding })}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden
            className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </h2>

      {open && (
        <div id="lost-and-found-body" className="border-t border-border p-5">
          {items.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('inventory.lostAndFound.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {items.map((item) => (
                <FoundRow key={item.id} item={item} canManage={canManage} />
              ))}
            </ul>
          )}

          {canManage && (
            <div className="mt-4 border-t border-border pt-4">
              {adding ? (
                <AddFound
                  facilityId={facilityId}
                  students={students}
                  locations={locations}
                  onDone={() => setAdding(false)}
                />
              ) : (
                <button type="button" className={BUTTON} onClick={() => setAdding(true)}>
                  <Plus aria-hidden className="size-4" />
                  {t('inventory.lostAndFound.add')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function FoundRow({
  item,
  canManage,
}: {
  item: LostAndFoundItem;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [returnState, giveBack, returning] = useSavedAction(returnFoundAction, INITIAL);
  const [removeState, remove, removing] = useSavedAction(removeFoundAction, INITIAL);

  const returned = item.status === 'returned';

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <span className={cn('font-medium', returned && 'text-foreground-muted line-through')}>
          {item.description}
        </span>

        <span className="block text-sm text-foreground-muted">
          {[
            item.foundOn,
            item.locationFound ?? '',
            item.studentName ?? '',
          ]
            .filter((part) => part !== '')
            .join(' · ')}
        </span>

        {item.notes !== null && item.notes !== '' && (
          <span className="block text-sm text-foreground-muted">{item.notes}</span>
        )}

        {/*
          Two facts an operator wants at a glance, both as words. "Returned" is
          the state; "the student was told" is a separate thing that stays true
          after it goes back, which is why the stamp outlives the status.
        */}
        <span className="mt-1 flex flex-wrap gap-x-3 text-sm">
          <span className={returned ? 'text-success' : 'text-warning'}>
            {returned
              ? t('inventory.lostAndFound.returned')
              : t('inventory.lostAndFound.waiting')}
          </span>
          {item.studentNotifiedAt !== null && (
            <span className="text-foreground-muted">
              {t('inventory.lostAndFound.notified')}
            </span>
          )}
        </span>

        <Failure state={returnState} />
        <Failure state={removeState} />
      </div>

      {canManage && (
        <span className="flex shrink-0 items-center gap-4">
          {!returned && (
            <form action={giveBack}>
              <input type="hidden" name="itemId" value={item.id} />
              <button type="submit" disabled={returning} className={LINK}>
                {returning ? t('common.working') : t('inventory.lostAndFound.markReturned')}
              </button>
            </form>
          )}

          {/* Owner/admin only, and refused by the API as well — G1. */}
          <form action={remove}>
            <input type="hidden" name="itemId" value={item.id} />
            <button
              type="submit"
              disabled={removing}
              aria-label={t('common.remove')}
              className="rounded text-danger hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </form>
        </span>
      )}
    </li>
  );
}

function AddFound({
  facilityId,
  students,
  locations,
  onDone,
}: {
  facilityId: string;
  students: { id: string; name: string }[];
  locations: string[];
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(recordFoundAction, INITIAL);

  return (
    <form action={action} onSubmit={() => onDone()} className="flex flex-col gap-3">
      <input type="hidden" name="facilityId" value={facilityId} />

      <div className="flex flex-wrap gap-3">
        <div className={cn(FIELD_COLUMN, 'sm:w-64')}>
          <label htmlFor="lf-description" className={FIELD_LABEL}>
            {t('inventory.lostAndFound.description')}
          </label>
          <input
            id="lf-description"
            name="description"
            maxLength={200}
            required
            className={CONTROL_LINE}
            {...(state.fields?.['description'] === undefined
              ? {}
              : { 'aria-invalid': true })}
          />
        </div>

        {/* The store room's own suggestions: one vocabulary for both halves. */}
        <div className={cn(FIELD_COLUMN, 'sm:w-48')}>
          <label htmlFor="lf-location" className={FIELD_LABEL}>
            {t('inventory.lostAndFound.locationFound')}
          </label>
          <input
            id="lf-location"
            name="locationFound"
            maxLength={120}
            list="lf-locations"
            className={CONTROL_LINE}
          />
          <datalist id="lf-locations">
            {locations.map((place) => (
              <option key={place} value={place} />
            ))}
          </datalist>
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-40')}>
          <label htmlFor="lf-found-on" className={FIELD_LABEL}>
            {t('inventory.lostAndFound.foundOn')}
          </label>
          {/* A date, never a datetime — the column is a `date` for that reason. */}
          <input id="lf-found-on" name="foundOn" type="date" className={CONTROL_LINE} />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-56')}>
          <label htmlFor="lf-student" className={FIELD_LABEL}>
            {t('inventory.lostAndFound.student')}
          </label>
          {/*
            A `<select>` over this site's register, not a search box. A club's
            list is a few hundred names at most, and a complete picker is what
            lets somebody find a child whose name they are unsure how to spell.
            Empty is the ordinary answer.
          */}
          <select id="lf-student" name="studentId" defaultValue="" className={CONTROL_LINE}>
            <option value="">{t('inventory.lostAndFound.noStudent')}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
          <p className="text-sm text-foreground-muted">
            {t('inventory.lostAndFound.studentHint')}
          </p>
        </div>
      </div>

      <div className={cn(FIELD_COLUMN, 'sm:w-96')}>
        <label htmlFor="lf-notes" className={FIELD_LABEL}>
          {t('inventory.field.notes')}
        </label>
        <input id="lf-notes" name="notes" maxLength={500} className={CONTROL_LINE} />
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? t('common.working') : t('inventory.lostAndFound.save')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="h-control rounded border border-border px-4 text-sm hover:bg-surface-muted"
        >
          {t('common.cancel')}
        </button>
      </div>

      <Failure state={state} />
    </form>
  );
}

/** Whatever the API refused, said in the reader's language. Never a raw 500 — G2. */
function Failure({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.ok) return null;
  if (state.errorKey === undefined && state.fields === undefined) return null;

  return (
    <p className="text-sm text-danger">
      {state.errorKey !== undefined
        ? t(state.errorKey)
        : Object.values(state.fields ?? {})
            .map((key) => t(key))
            .join(' ')}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}
