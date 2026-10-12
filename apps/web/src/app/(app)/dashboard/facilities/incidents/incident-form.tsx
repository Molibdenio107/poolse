'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
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
  recordIncidentAction,
  searchMembersAction,
  searchStaffAction,
  searchStudentsAction,
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

  useFocusFirstError(form, state.fields, state);

  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.ok && state.id !== undefined) {
      toast.show('success', t('incidents.recorded'));
      router.push(`/dashboard/facilities/incidents/${state.id}`);
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
            error={fieldError('occurredAt')}
          />
          <SelectField
            name="place"
            label={t('incidents.field.place')}
            initial=""
            options={[{ value: '', label: t('incidents.elsewhere') }, ...places]}
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

        <PersonPicker
          name="lifeguardMembershipId"
          label={t('incidents.field.lifeguard')}
          hint={t('incidents.field.lifeguardHint')}
          search={searchStaffAction}
        />

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
