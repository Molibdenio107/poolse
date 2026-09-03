'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, Users } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { PartnerGroup, StudentLevel } from '@/lib/api';
import { SelectField, TextField } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../../../actions';
import { archiveGroupAction, saveGroupAction } from '../../[facilityId]/partners.actions';

/**
 * The groups a partner sends — POOLSE-47, criteria 4 and 10.
 *
 * **This is the bookable thing.** `6A` goes on the lane grid; `ES D. Dinis`
 * never does. A school books thirty class-groups across a week, each with its
 * own size, level and instructor arrangement, and booking "the school" would be
 * one cell meaning thirty different things.
 *
 * **Not paginated, and the exemption is written down.** A partner's groups are
 * bounded by the partner — a school has as many classes as it has classes, and
 * paging them would hide 6B from somebody looking for it. `CONVENTIONS.md`
 * records this beside the other exemptions.
 *
 * **Zero participants is a real answer.** A club agrees the timetable in July
 * and finds out in September how many children turn up. The field defaults to 0
 * and says what that means rather than demanding a number nobody has.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'inline-flex h-control items-center gap-2 rounded border border-border px-3 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function PartnerGroups({
  partnerId,
  groups,
  levels,
  canManage,
}: {
  partnerId: string;
  groups: PartnerGroup[];
  levels: StudentLevel[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('partners.groups')}
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">{t('partners.groupsAreBooked')}</p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setEditing((was) => (was === 'new' ? null : 'new'))}
            className={BUTTON_QUIET}
          >
            <Plus className="size-4" aria-hidden />
            {t('partners.addGroup')}
          </button>
        )}
      </div>

      {editing === 'new' && canManage && (
        <GroupForm
          partnerId={partnerId}
          group={null}
          levels={levels}
          onDone={() => setEditing(null)}
        />
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('partners.noGroups')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {groups.map((group) => (
            <li key={group.id} className="py-3 first:pt-0 last:pb-0">
              {editing === group.id && canManage ? (
                <GroupForm
                  partnerId={partnerId}
                  group={group}
                  levels={levels}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{group.name}</span>

                      {group.tag !== null && (
                        /*
                          The club's own margin note — `DE` for desporto escolar.
                          A bordered chip rather than a colour, so it survives
                          both themes and means the same thing to everybody.
                        */
                        <span className="rounded border border-border px-1.5 py-0.5 text-xs text-foreground-muted">
                          {group.tag}
                        </span>
                      )}
                    </div>

                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-muted">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden />
                        {t('partners.participants', { count: group.participantCount })}
                      </span>

                      {group.levelName !== null && <span>{group.levelName}</span>}

                      {/*
                        Spelled out, because it decides two things a reader
                        cannot otherwise see: the booking counts as staffed, and
                        the group never appears in the "sem professor" alert.
                      */}
                      {group.bringsOwnInstructor && (
                        <span>
                          {group.ownInstructorName === null
                            ? t('partners.ownInstructor')
                            : t('partners.ownInstructorNamed', {
                                name: group.ownInstructorName,
                              })}
                        </span>
                      )}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(group.id)}
                        className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {t('common.edit')}
                      </button>
                      <RemoveGroup partnerId={partnerId} group={group} />
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        The nominal roster — criterion 10.

        Modelled in the schema and shipped visibly disabled, because the club may
        simply not hold the list of names, and a screen that demands data nobody
        has reads as broken. Turning it on later is a UI change rather than a
        migration.
      */}
      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium">{t('partners.roster')}</h3>
        <p className="mt-1 text-sm text-foreground-muted">{t('partners.rosterDeferred')}</p>
        <button
          type="button"
          disabled
          className={cn(
            BUTTON_QUIET,
            'mt-3 cursor-not-allowed opacity-60 hover:bg-transparent',
          )}
        >
          {t('partners.addRosterName')}
        </button>
      </div>
    </section>
  );
}

function GroupForm({
  partnerId,
  group,
  levels,
  onDone,
}: {
  partnerId: string;
  group: PartnerGroup | null;
  levels: StudentLevel[];
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, save, pending] = useSavedAction(saveGroupAction, INITIAL);

  /*
   * Controlled, so the instructor-name box appears the moment the box is ticked
   * rather than after a save. It is also what stops a name being submitted for a
   * group that brings nobody — the CHECK forbids that pair, and the field simply
   * is not there to fill in.
   */
  const [bringsOwn, setBringsOwn] = useState(group?.bringsOwnInstructor ?? false);

  return (
    <form
      action={save}
      className="flex flex-col gap-4 rounded border border-border bg-surface-muted p-4"
    >
      <input type="hidden" name="partnerId" value={partnerId} />
      {group !== null && <input type="hidden" name="groupId" value={group.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="name"
          label={t('partners.groupName')}
          initial={group?.name ?? ''}
          required
          maxLength={120}
          hint={t('partners.groupNameHint')}
          error={state.fields?.['name'] ? t(state.fields['name']) : undefined}
        />

        <TextField
          name="participantCount"
          label={t('partners.participantCount')}
          type="number"
          initial={String(group?.participantCount ?? 0)}
          hint={t('partners.participantCountHint')}
          error={
            state.fields?.['participantCount'] ? t(state.fields['participantCount']) : undefined
          }
        />

        <SelectField
          name="levelId"
          label={t('partners.level')}
          initial={group?.levelId ?? ''}
          hint={t('partners.levelHint')}
          options={[
            { value: '', label: t('partners.noLevel') },
            ...levels.map((level) => ({ value: level.id, label: level.name })),
          ]}
        />

        <TextField
          name="tag"
          label={t('partners.tag')}
          initial={group?.tag ?? ''}
          maxLength={40}
          hint={t('partners.tagHint')}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="bringsOwnInstructor"
          checked={bringsOwn}
          onChange={(event) => setBringsOwn(event.target.checked)}
          className="size-4 rounded border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        {t('partners.bringsOwnInstructor')}
      </label>

      {bringsOwn && (
        <TextField
          name="ownInstructorName"
          label={t('partners.ownInstructorName')}
          initial={group?.ownInstructorName ?? ''}
          maxLength={160}
          hint={t('partners.ownInstructorHint')}
        />
      )}

      {state.errorKey !== undefined && <p className="text-sm text-danger">{t(state.errorKey)}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('common.save')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function RemoveGroup({
  partnerId,
  group,
}: {
  partnerId: string;
  group: PartnerGroup;
}): React.ReactElement {
  const t = useTranslations();
  const [state, remove, pending] = useSavedAction(archiveGroupAction, INITIAL);

  return (
    <form action={remove} className="flex items-center gap-2">
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="groupId" value={group.id} />

      {/*
        The refusal is rendered here, beside the button that caused it, rather
        than at the top of the page. "This group is still booked" is only useful
        next to the group it is about.
      */}
      {state.errorKey !== undefined && (
        <span className="text-sm text-danger">{t(state.errorKey)}</span>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-label={t('partners.removeGroupNamed', { name: group.name })}
        className="rounded p-1 text-foreground-muted hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </form>
  );
}
