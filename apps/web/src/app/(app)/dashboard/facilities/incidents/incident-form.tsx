'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lock, TriangleAlert } from 'lucide-react';
import {
  SelectField,
  TextAreaField,
  TextField,
  useFocusFirstError,
} from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { PersonPicker } from './person-picker';
import {
  onDutyAction,
  recordIncidentAction,
  searchMembersAction,
  searchStaffAction,
  searchStudentsAction,
  type PickOption,
  type RecordState,
} from './incidents.actions';

type PersonKind = 'student' | 'member' | 'visitor';
const KINDS: readonly PersonKind[] = ['student', 'member', 'visitor'];

const TEXT_MAX = 5000;
const SHORT_MAX = 200;

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The new-incident form — POOLSE-70, slice 1.
 *
 * **Two halves, drawn as two.** The facts — when, where, who, whether the
 * emergency services came, who was on duty — are what every member of staff
 * reads in the list. What happened, the injury and the first aid are encrypted
 * and readable only by the owner, the admins and the author, so they sit in
 * their own panel under a lock that says so *before* anybody types into it: the
 * writer should know who will read their words while choosing them.
 *
 * **Never edited afterwards**, which is why it says so at the button: a
 * correction is an addendum on the incident's page.
 *
 * `useActionState`, not `useSavedAction`: a recorded incident navigates to its
 * own page, and the shared hook would refresh this one on the way out — the
 * composer's reasoning (POOLSE-67). The outcome is reported here instead, once.
 *
 * **The lifeguard comes from the roster, and the writer has the last word** —
 * POOLSE-70 slice 2. Once a tank and a moment are chosen the form asks who was
 * on duty, says so beside the field, and fills the field with the first of them
 * *while the writer has not touched it*. Any choice the writer makes — a person
 * or clearing it — is never overwritten. A person the roster shows without a
 * valid lifeguard qualification that day is a warning beside the field, and the
 * incident records exactly as before.
 */
export function IncidentForm({
  facilityId,
  places,
  now,
}: {
  facilityId: string;
  /** The site's tanks then its spaces, values prefixed `pool:` / `space:`. */
  places: { value: string; label: string }[];
  /** `YYYY-MM-DDTHH:mm` on the site's wall clock. */
  now: string;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);

  const [state, submit, pending] = useActionState<RecordState, FormData>(
    recordIncidentAction.bind(null, facilityId),
    { ok: false },
  );
  const [kind, setKind] = useState<PersonKind>('student');
  const [emergency, setEmergency] = useState(false);

  const [place, setPlace] = useState('');
  const [occurredAt, setOccurredAt] = useState(now);
  const [lifeguard, setLifeguard] = useState<PickOption | null>(null);
  // Set the first time the writer picks or clears the lifeguard themselves.
  const writerChose = useRef(false);
  const [roster, setRoster] = useState<RosterState>({ state: 'idle' });

  useEffect(() => {
    const poolId = place.startsWith('pool:') ? place.slice(5) : null;
    if (poolId === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(occurredAt)) {
      setRoster({ state: 'idle' });
      return;
    }
    let stale = false;
    // A pause while the time is typed, so each keystroke is not a request.
    const timer = setTimeout(() => {
      setRoster({ state: 'loading' });
      void onDutyAction(facilityId, poolId, occurredAt).then((found) => {
        if (stale) return;
        if (found === null) {
          setRoster({ state: 'failed' });
          return;
        }
        setRoster({ state: 'done', people: found });
        if (!writerChose.current) {
          const first = found[0];
          setLifeguard(
            first === undefined
              ? null
              : {
                  id: first.membershipId,
                  // Named at render, so this effect need not depend on `t`.
                  name: first.name ?? '',
                  detail: null,
                },
          );
        }
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [place, occurredAt, facilityId]);

  useFocusFirstError(form, state.fields, state);

  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.ok && state.id !== undefined) {
      toast.show('success', t('incidents.recorded'));
      // To the list, on this site, with the new row lit for a moment — POOLSE-92
      // H. The incident's own page is one click away; the list is where somebody
      // recording several in a row needs to be.
      router.push(`/dashboard/facilities/incidents?site=${facilityId}&new=${state.id}`);
      return;
    }
    if (state.ok) return;
    let message: string;
    try {
      message =
        state.errorKey === undefined
          ? t('common.checkTheFields')
          : t(state.errorKey as never, state.values as never);
    } catch {
      message = t('incidents.error.recordFailed');
    }
    if (state.errorKey === undefined && state.fields === undefined) return;
    toast.show(
      'danger',
      state.detail === undefined || state.detail === '' ? message : `${message} — ${state.detail}`,
    );
  }, [state, router, toast, t]);

  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  return (
    <form ref={form} action={submit} className="flex flex-col gap-6">
      <section
        aria-labelledby="incident-facts"
        className="flex flex-col gap-4 rounded border border-border bg-surface p-5"
      >
        <h2 id="incident-facts" className="font-medium">
          {t('incidents.factsTitle')}
        </h2>

        <div className="flex flex-wrap gap-4">
          <TextField
            name="occurredAt"
            type="datetime-local"
            label={t('incidents.field.occurredAt')}
            hint={t('incidents.field.occurredAtHint')}
            initial={now}
            required
            onValueChange={setOccurredAt}
            error={fieldError('occurredAt')}
          />
          <SelectField
            name="place"
            label={t('incidents.field.place')}
            initial=""
            options={[{ value: '', label: t('incidents.elsewhere') }, ...places]}
            onValueChange={setPlace}
            error={fieldError('place')}
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm text-foreground-muted">
            {t('incidents.field.person')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((one) => (
              <label
                key={one}
                className={cn(
                  'inline-flex h-control cursor-pointer items-center gap-2 rounded border px-4 text-control focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary',
                  kind === one ? 'border-primary bg-surface-muted font-medium' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="personKind"
                  value={one}
                  checked={kind === one}
                  onChange={() => setKind(one)}
                />
                {t(`incidents.kindOption.${one}`)}
              </label>
            ))}
          </div>

          {/* Keyed by kind, so each starts empty rather than inheriting a search. */}
          {kind === 'student' && (
            <PersonPicker
              key="student"
              name="studentId"
              label={t('incidents.field.student')}
              search={searchStudentsAction}
              error={fieldError('person')}
            />
          )}
          {kind === 'member' && (
            <PersonPicker
              key="member"
              name="membershipId"
              label={t('incidents.field.member')}
              search={searchMembersAction}
              error={fieldError('person')}
            />
          )}
          {kind === 'visitor' && (
            <TextField
              key="visitor"
              name="visitorName"
              label={t('incidents.field.visitorName')}
              hint={t('incidents.field.visitorHint')}
              maxLength={SHORT_MAX}
              autoComplete="off"
              error={fieldError('person')}
              className="max-w-form"
            />
          )}
        </fieldset>

        <label className="inline-flex h-control items-center gap-2 text-control">
          <input
            type="checkbox"
            name="emergencyCalled"
            checked={emergency}
            onChange={(event) => setEmergency(event.target.checked)}
          />
          {t('incidents.field.emergencyCalled')}
        </label>

        <div className="flex flex-col gap-2">
          <PersonPicker
            name="lifeguardMembershipId"
            label={t('incidents.field.lifeguard')}
            hint={t('incidents.field.lifeguardHint')}
            search={searchStaffAction}
            chosen={
              lifeguard === null || lifeguard.name !== ''
                ? lifeguard
                : { ...lifeguard, name: t('incidents.unknownPerson') }
            }
            onChosenChange={(option) => {
              writerChose.current = true;
              setLifeguard(option);
            }}
          />
          <RosterNote roster={roster} />
        </div>

        <TextField
          name="policyReference"
          label={t('incidents.field.policyReference')}
          hint={t('incidents.field.policyReferenceHint')}
          maxLength={SHORT_MAX}
          className="max-w-form"
        />
      </section>

      <section
        aria-labelledby="incident-clinical"
        className="flex flex-col gap-4 rounded border-2 border-border-strong bg-surface p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 id="incident-clinical" className="flex items-center gap-2 font-medium">
            <Lock aria-hidden className="size-4" />
            {t('incidents.clinicalTitle')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('incidents.clinicalHint')}</p>
        </div>

        <TextAreaField
          name="whatHappened"
          label={t('incidents.field.whatHappened')}
          rows={6}
          maxLength={TEXT_MAX}
          required
          error={fieldError('whatHappened')}
        />
        <TextAreaField
          name="injury"
          label={t('incidents.field.injury')}
          rows={3}
          maxLength={TEXT_MAX}
        />
        <TextAreaField
          name="firstAid"
          label={t('incidents.field.firstAid')}
          rows={3}
          maxLength={TEXT_MAX}
        />
      </section>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-foreground-muted">{t('incidents.neverEdited')}</p>
        <div>
          <button type="submit" disabled={pending} className={PRIMARY}>
            {pending ? t('incidents.recording') : t('incidents.record')}
          </button>
        </div>
      </div>
    </form>
  );
}

type RosterState =
  | { state: 'idle' | 'loading' | 'failed' }
  | {
      state: 'done';
      people: { membershipId: string; name: string | null; licensed: boolean }[];
    };

/**
 * What the roster says beside the lifeguard field. Says nothing until a tank and
 * a moment are chosen; a roster that could not be read says so, because silence
 * would read as "nobody was on duty".
 */
function RosterNote({ roster }: { roster: RosterState }): React.ReactElement | null {
  const t = useTranslations();
  if (roster.state === 'idle') return null;
  if (roster.state === 'loading') {
    return <p className="text-sm text-foreground-muted">{t('incidents.roster.loading')}</p>;
  }
  if (roster.state === 'failed') {
    return <p className="text-sm text-foreground-muted">{t('incidents.roster.failed')}</p>;
  }
  if (roster.state !== 'done') return null;
  if (roster.people.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('incidents.roster.nobody')}</p>;
  }
  const name = (person: { name: string | null }): string =>
    person.name ?? t('incidents.unknownPerson');
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-foreground-muted">
        {t('incidents.roster.onDuty', { names: roster.people.map(name).join(', ') })}
      </p>
      {roster.people
        .filter((person) => !person.licensed)
        .map((person) => (
          <p key={person.membershipId} className="inline-flex items-center gap-1.5">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
            {t('incidents.roster.notLicensed', { name: name(person) })}
          </p>
        ))}
    </div>
  );
}
