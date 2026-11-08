'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { SelectField, TextAreaField, TextField, useFocusFirstError } from '@/components/ui/field';
import { formatDate } from '@/lib/date-format';
import { submitRegistrationAction, type RegistrationState } from './registration.actions';

const INITIAL: RegistrationState = { status: 'idle' };

/** Every sentence the form shows, translated on the server — there is no
 * next-intl provider outside the app shell. */
export type RegistrationLabels = Record<
  | 'swimmer' | 'swimmerFirstName' | 'swimmerLastName' | 'swimmerBirthDate' | 'swimmerTaxNumber'
  | 'guardian' | 'guardianHint' | 'guardianName' | 'guardianRelationship'
  | 'guardianRelationshipHint' | 'guardianTaxNumber' | 'contact' | 'email' | 'emailHint'
  | 'phone' | 'preferences' | 'facility' | 'level' | 'sport' | 'noPreference' | 'days' | 'daysHint'
  | 'note' | 'noteHint' | 'consent' | 'submit' | 'sending' | 'sentTitle' | 'sentBody' | 'sentOn' | 'another'
  | 'failed' | 'optional' | 'honeypot' | 'kinshipChoose',
  string
>;

export function RegistrationForm({
  slug,
  locale,
  stamp,
  majority,
  facilities,
  levels,
  sports = [],
  weekdays,
  labels,
  errors,
  kinship,
}: {
  /** *Grau de parentesco*: the saved word and its label in the reader's language. */
  kinship: { value: string; label: string }[];
  slug: string;
  locale: 'pt-PT' | 'en';
  stamp: string;
  /** The club's age of majority; under it, the guardian is required. */
  majority: number;
  facilities: { id: string; name: string }[];
  levels: { id: string; name: string; sportId?: string }[];
  /**
   * The club's sports, already named — POOLSE-143 rule 6. Empty for a pool-only
   * club, whose form is exactly what it was. Chosen first, it narrows the levels;
   * it is not sent, because the level a family picks already carries its sport.
   */
  sports?: { value: string; label: string }[];
  /** ISO weekday (1 = Monday) and its name in the reader's language. */
  weekdays: { value: number; label: string }[];
  labels: RegistrationLabels;
  /** Translation key → sentence, for the keys the API names fields with. */
  errors: Record<string, string>;
}): React.ReactElement {
  const [state, action, pending] = useActionState(submitRegistrationAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);

  // Controlled, so a refused send keeps every tick — React 19 resets the form.
  const [days, setDays] = useState<number[]>([]);
  const [sport, setSport] = useState('');
  const shownLevels = sport === '' ? levels : levels.filter((level) => level.sportId === sport);
  const [consent, setConsent] = useState(false);
  // An adult signs themself up: no guardian section (Rui, 07-11-2026). The API
  // drops one for an adult anyway; this only stops asking for it.
  const [birthDate, setBirthDate] = useState('');
  const adult = (() => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
    if (match === null) return false;
    const now = new Date();
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const age = now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
    return age >= majority;
  })();

  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : (errors[key] ?? key);
  };

  /*
   * A reload used to show the empty form again, as if nothing had been sent (Rui,
   * 07-11-2026). The server cannot say — it answers every send the same, so a
   * stranger learns nothing about who is registered — so this browser remembers
   * the day it sent one to this club, for 30 days, and nothing else.
   */
  const memoryKey = `poolse.inscricao.${slug}`;
  const [rememberedOn, setRememberedOn] = useState<string | null>(null);
  const [another, setAnother] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(memoryKey);
      if (saved !== null && Date.now() - new Date(saved).getTime() < 30 * 86_400_000) setRememberedOn(saved);
      else if (saved !== null) window.localStorage.removeItem(memoryKey);
    } catch {
      // A browser that keeps nothing simply shows the form.
    }
  }, [memoryKey]);
  useEffect(() => {
    if (state.status !== 'sent') return;
    const now = new Date().toISOString();
    setRememberedOn(now);
    setAnother(false);
    try {
      window.localStorage.setItem(memoryKey, now);
    } catch {
      // Nothing to remember it in; the sent screen still shows until a reload.
    }
  }, [state, memoryKey]);

  if ((state.status === 'sent' || rememberedOn !== null) && !another) {
    return (
      <section
        role="status"
        className="flex flex-col gap-2 rounded bg-surface p-5 shadow-card"
      >
        <p className="flex items-center gap-2 text-lg font-semibold">
          <CheckCircle2 aria-hidden className="size-5 text-success" />
          {labels.sentTitle}
        </p>
        {rememberedOn !== null && (
          <p className="text-sm">{labels.sentOn.replace('{date}', formatDate(rememberedOn))}</p>
        )}
        <p className="text-foreground-muted">{labels.sentBody}</p>
        <button
          type="button"
          onClick={() => setAnother(true)}
          className="self-start text-sm text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {labels.another}
        </button>
      </section>
    );
  }

  const section = 'flex flex-col gap-4 rounded bg-surface p-5 shadow-card';
  const legend = 'text-base font-semibold';

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="majority" value={majority} />

      {/* The honeypot. Off-screen rather than display:none, which some scripts skip. */}
      <div aria-hidden className="absolute -left-[10000px] top-auto size-px overflow-hidden">
        <label>
          {labels.honeypot}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className={section}>
        <legend className={legend}>{labels.swimmer}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="swimmerFirstName" label={labels.swimmerFirstName} required
            autoComplete="off" maxLength={100} error={error('swimmerFirstName')} />
          <TextField name="swimmerLastName" label={labels.swimmerLastName} required
            autoComplete="off" maxLength={100} error={error('swimmerLastName')} />
          <TextField name="swimmerBirthDate" type="date" label={labels.swimmerBirthDate}
            required onValueChange={setBirthDate} error={error('swimmerBirthDate')} />
          <TextField inputMode="numeric" name="swimmerTaxNumber" label={labels.swimmerTaxNumber}
            hint={labels.optional} maxLength={20} error={error('swimmerTaxNumber')} />
        </div>
      </fieldset>

      <fieldset className={adult ? 'hidden' : section} disabled={adult}>
        <legend className={legend}>{labels.guardian}</legend>
        <p className="text-sm text-foreground-muted">{labels.guardianHint}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="guardianName" label={labels.guardianName} autoComplete="name"
            maxLength={200} error={error('guardianName')} />
          <SelectField name="guardianRelationship" label={labels.guardianRelationship}
            options={[{ value: '', label: labels.kinshipChoose, disabled: true }, ...kinship]}
            error={error('guardianRelationship')} />
          <TextField inputMode="numeric" name="guardianTaxNumber" label={labels.guardianTaxNumber}
            hint={labels.optional} maxLength={20} error={error('guardianTaxNumber')} />
        </div>
      </fieldset>

      <fieldset className={section}>
        <legend className={legend}>{labels.contact}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="email" type="email" label={labels.email} hint={labels.emailHint}
            required autoComplete="email" maxLength={254} error={error('email')} />
          <TextField name="phone" type="tel" label={labels.phone} hint={labels.optional}
            autoComplete="tel" maxLength={40} error={error('phone')} />
        </div>
      </fieldset>

      <fieldset className={section}>
        <legend className={legend}>{labels.preferences}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {facilities.length > 1 && (
            <SelectField
              name="facilityId"
              label={labels.facility}
              options={[
                { value: '', label: labels.noPreference },
                ...facilities.map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
          )}
          {sports.length > 1 && (
            <SelectField
              name="sport"
              label={labels.sport}
              options={[{ value: '', label: labels.noPreference }, ...sports]}
              onValueChange={setSport}
            />
          )}
          {shownLevels.length > 0 && (
            <SelectField
              // A new sport is a new list of levels; the choice starts over.
              key={sport}
              name="levelId"
              label={labels.level}
              options={[
                { value: '', label: labels.noPreference },
                ...shownLevels.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-foreground-muted">{labels.days}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {weekdays.map((day) => (
              <label key={day.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="preferredDays"
                  value={day.value}
                  checked={days.includes(day.value)}
                  onChange={(event) =>
                    setDays((current) =>
                      event.target.checked
                        ? [...current, day.value]
                        : current.filter((d) => d !== day.value),
                    )
                  }
                  className="size-4 accent-primary"
                />
                {day.label}
              </label>
            ))}
          </div>
          <span className="text-sm text-foreground-muted">{labels.daysHint}</span>
        </div>
        <TextAreaField name="note" label={labels.note} hint={labels.noteHint}
          maxLength={2000} error={error('note')} />
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="consent"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            aria-invalid={error('consent') !== undefined}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span className="text-sm">{labels.consent}</span>
        </label>
        {error('consent') !== undefined && (
          <span className="text-sm text-danger">{error('consent')}</span>
        )}
      </div>

      {state.status === 'failed' && (
        <p role="alert" className="text-sm text-danger">{labels.failed}</p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control text-primary-foreground disabled:opacity-60 font-semibold"
        >
          {pending ? labels.sending : labels.submit}
        </button>
      </div>
    </form>
  );
}
