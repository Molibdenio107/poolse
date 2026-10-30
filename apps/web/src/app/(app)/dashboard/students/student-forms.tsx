'use client';

import { Fragment, useEffect, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useLocale, useTranslations } from 'next-intl';
import type { Guardian, StudentIdDocument, StudentIdentity, StudentLevel } from '../../../../lib/api';
import { countryOptions } from '@/lib/countries';
import {
  CONTROL_LINE,
  FIELD_COLUMN,
  FIELD_LABEL,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/ui/field';
import { GuardianBlock } from './guardian-block';
import { fitsLevel } from '@/lib/ages';
import type { FormState } from '../actions';
import { archiveStudentAction, createStudentAction, updateStudentAction } from './students.actions';
import { Dialog } from '@/components/ui/dialog';

const INITIAL: FormState = { ok: false };

function Problem({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;
  return (
    <p className="text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

export interface StudentFormValues {
  id?: string;
  guardians?: Guardian[];
  firstName?: string;
  lastName?: string;
  birthDate?: string | null;
  gender?: 'male' | 'female' | null;
  levelId?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  taxNumber?: string | null;
  federationLicence?: string | null;
  notes?: string | null;
  identity?: StudentIdentity;
}

/**
 * One form for both creating and editing, because they take the same fields and
 * two near-identical forms drift apart the first time one gains a field.
 *
 * The notes box is labelled and hinted deliberately. It is ordinary notes —
 * "prefers the shallow end", "sibling of Ana" — and a free-text box on a child's
 * record is exactly where somebody types an allergy if nothing tells them not
 * to. Medical information is special-category data under GDPR and gets its own
 * table, its own access rules and its own audit trail in slice 1.3.
 */
export function StudentForm({
  organizationId,
  levels,
  student,
  mode,
  ageOfMajority,
  idDocument,
}: {
  organizationId: string;
  levels: StudentLevel[];
  student?: StudentFormValues;
  mode: 'create' | 'edit';
  /**
   * The ID document, number in full (Rui, 30-10-2026). Undefined leaves the
   * fields out — a create, or a reader the API does not answer.
   */
  idDocument?: StudentIdDocument | null;
  /** The club's maioridade — POOLSE-22. Comes from the API, never a literal. */
  ageOfMajority: number;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(
    mode === 'create' ? createStudentAction : updateStudentAction,
    INITIAL,
  );

  /*
   * The date of birth, lifted — F-09.
   *
   * The guardian block branches on it and used to read this input out of the DOM
   * by id. A controlled field generates its own id, and holding the value here
   * is what that listener was standing in for.
   */
  const [birthDate, setBirthDate] = useState(student?.birthDate ?? '');

  /**
   * The server's error for one field, ready to spread onto its component.
   *
   * Spread rather than passed as `error={undefined}` because these props are
   * `exactOptionalPropertyTypes`: an explicit undefined is not the same as
   * absent.
   */
  const fieldError = (name: string): { error?: string } =>
    state.fields?.[name] === undefined ? {} : { error: t(state.fields[name]!) };

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      {student?.id !== undefined && <input type="hidden" name="studentId" value={student.id} />}

      {/*
        Every field controlled — F-09, and the tidy-up the NIF field's comment
        used to defer.

        React 19 resets a form as soon as a function action returns, *including*
        when it returns a validation error. So a future date of birth cleared the
        name, the level, the contact details and the guardian somebody had just
        typed, at the exact moment they were being asked to correct one field.
        POOLSE-09 and POOLSE-10 were the same bug twice; this was the third.

        These components also carry their own label, hint and field-level error,
        which is what lets each server rejection land under the box it is about
        rather than as a sentence at the top of the page.
      */}
      {/*
        One form, grouped by context and not titled (Rui, 30-10-2026): who the
        student is, how to reach them and where they live, their documents,
        their family and situation, and their swimming. A rule between groups
        is the only separation.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          name="firstName"
          label={t('students.firstName')}
          initial={student?.firstName ?? ''}
          maxLength={120}
          required
          className="max-w-none"
          {...fieldError('firstName')}
        />

        <TextField
          name="lastName"
          label={t('students.lastName')}
          initial={student?.lastName ?? ''}
          maxLength={120}
          required
          className="max-w-none"
          {...fieldError('lastName')}
        />

        {/*
          Held in state rather than read out of the DOM by id.

          The guardian block needs to know the date to decide whether to show
          itself, and it used to listen to this input through
          `document.getElementById`. A controlled field has no stable id — the
          component generates its own — and lifting the value is what that hack
          was standing in for anyway.
        */}
        <TextField
          name="birthDate"
          type="date"
          label={t('students.birthDate')}
          initial={student?.birthDate ?? ''}
          onValueChange={setBirthDate}
          className="max-w-none"
          {...fieldError('birthDate')}
        />

        {/*
          Masculino or feminino — round 5, and optional.

          Beside the date of birth because they are the same kind of fact and
          because both are what an escalão is chosen against. Blank stays a real
          answer: most imported rows have nothing here, and a required field
          would be filled in by guessing from a first name.
        */}
        <SelectField
          name="gender"
          label={t('students.gender')}
          initial={student?.gender ?? ''}
          options={[
            { value: '', label: t('students.genderUnknown') },
            { value: 'male', label: t('students.genderMale') },
            { value: 'female', label: t('students.genderFemale') },
          ]}
          className="max-w-none"
          {...fieldError('gender')}
        />

        <IdentityFields identity={student?.identity} fieldError={fieldError} only={['nationality', 'birthplace']} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-border pt-5">
        <TextField
          name="contactEmail"
          type="email"
          label={t('students.contactEmail')}
          initial={student?.contactEmail ?? ''}
          maxLength={254}
          className="max-w-none"
          {...fieldError('contactEmail')}
        />

        <TextField
          name="contactPhone"
          type="tel"
          label={t('students.contactPhone')}
          initial={student?.contactPhone ?? ''}
          maxLength={40}
          className="max-w-none"
          {...fieldError('contactPhone')}
        />

        <IdentityFields identity={student?.identity} fieldError={fieldError} only={['addressLine', 'postalCode', 'locality']} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-border pt-5">
        <IdDocumentFields idDocument={idDocument} fieldError={fieldError} />

        <TextField
          name="taxNumber"
          inputMode="numeric"
          label={t('students.taxNumber')}
          initial={student?.taxNumber ?? ''}
          maxLength={40}
          hint={t('students.taxNumberHint')}
          className="max-w-none"
          {...fieldError('taxNumber')}
        />

        <IdentityFields identity={student?.identity} fieldError={fieldError} only={['snsNumber']} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-border pt-5">
        <IdentityFields identity={student?.identity} fieldError={fieldError} only={['parentOneName', 'parentTwoName', 'maritalStatus', 'profession', 'education']} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-border pt-5">
        <LevelPicker
          levels={levels}
          student={student}
          birthDate={birthDate}
          {...fieldError('ageConfirmed')}
        />

        {/* POOLSE-81: optional; warned about, never required, in a competitive level. */}
        <TextField
          name="federationLicence"
          label={t('students.federationLicence')}
          initial={student?.federationLicence ?? ''}
          maxLength={40}
          hint={t('students.federationLicenceHint')}
          className="max-w-none"
          {...fieldError('federationLicence')}
        />
      </div>


      {/* Prose, so it takes the wider cap rather than the single-control one. */}
      <div className="max-w-form">
        <TextAreaField
          name="notes"
          label={t('students.notes')}
          initial={student?.notes ?? ''}
          rows={3}
          maxLength={2000}
          className="max-w-none"
          {...fieldError('notes')}
        />
        <p className="mt-1.5 text-sm text-warning">{t('students.notesWarning')}</p>
      </div>

      {/*
        POOLSE-04. Its own section, appearing and disappearing with the date of
        birth without ever throwing away what has been typed into it.
      */}
      <GuardianBlock
        ageOfMajority={ageOfMajority}
        guardians={student?.guardians}
        birthDate={birthDate}
        errors={state.fields}
      />

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
        >
          {pending
            ? t('common.working')
            : mode === 'create'
              ? t('students.add')
              : t('common.save')}
        </button>
      </div>

      <Problem state={state} />
    </form>
  );
}

/**
 * Two steps, and the confirmation names the person.
 *
 * Archiving keeps the record — enrollment, attendance and invoices will point at
 * it — but it removes a child from every list the operator works from, and the
 * generic "are you sure?" is the question people learn to click through.
 */
export function ArchiveStudentButton({
  organizationId,
  studentId,
  name,
}: {
  organizationId: string;
  studentId: string;
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useSavedAction(archiveStudentAction, INITIAL);
  useEffect(() => {
    if (state.ok) setConfirming(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('students.archive')}
      </button>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('students.archive')}
        closeLabel={t('common.close')}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="studentId" value={studentId} />
          <p className="text-sm">
            {t('students.confirmArchive', { name })}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:bg-surface-muted"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-60"
            >
              {pending ? t('common.working') : t('facilities.confirmArchive')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}


/**
 * The level picker, with an age warning — backlog round 4, ticket 3.
 *
 * **A warning, not a block.** Real clubs have the four-year-old who swims with
 * the six-year-olds because that is where their sibling is, and the adult
 * beginner in a teenagers' class. A rule that cannot be overridden gets worked
 * around by typing a fake birth date, and then the data is worse than if the
 * check had never existed. So the mismatched level stays selectable, and
 * choosing it asks for confirmation once.
 *
 * **A missing birth date is never in anybody's way.** Most students will have
 * none — the spreadsheets waiting to be imported have a half-empty column — and
 * that is silence, not a warning.
 *
 * The birth date is read from the live form rather than from the saved student,
 * so typing a date and then picking a level warns on what was just typed.
 */
function LevelPicker({
  levels,
  student,
  birthDate,
  error,
}: {
  levels: StudentLevel[];
  student: StudentFormValues | undefined;
  /**
   * The date of birth as the form has it — F-09.
   *
   * This used to be read out of the DOM with `document.getElementById`, the same
   * hack the guardian block used. The date field is controlled now and generates
   * its own id, so the value is passed in; a listener left behind would have
   * silently stopped warning about a level that does not fit.
   */
  birthDate: string;
  /** The acknowledgement's own message, when the form came back asking for it. */
  error?: string;
}): React.ReactElement {
  const t = useTranslations();
  const [levelId, setLevelId] = useState(student?.levelId ?? '');

  const dob = birthDate === '' ? null : birthDate;
  const chosen = levels.find((level) => level.id === levelId) ?? null;
  const fit = chosen === null ? 'fits' : fitsLevel(chosen, dob);

  return (
    <div className={FIELD_COLUMN}>
      <label htmlFor="student-level" className={FIELD_LABEL}>
        {t('students.level')}
      </label>
      <select
        id="student-level"
        name="levelId"
        value={levelId}
        onChange={(event) => setLevelId(event.target.value)}
        aria-describedby={fit === 'tooYoung' || fit === 'tooOld' ? 'student-level-warning' : undefined}
        className={CONTROL_LINE}
      >
        <option value="">{t('students.noLevel')}</option>
        {levels.map((level) => {
          const levelFit = fitsLevel(level, dob);
          // Marked in the option text itself, because a `disabled` option would
          // be the hard block this story argues against, and colour alone does
          // not survive a native select on any platform.
          const mark =
            levelFit === 'tooYoung'
              ? ` — ${t('students.tooYoungFor')}`
              : levelFit === 'tooOld'
                ? ` — ${t('students.tooOldFor')}`
                : '';
          return (
            <option key={level.id} value={level.id}>
              {level.name}
              {mark}
            </option>
          );
        })}
      </select>

      {(fit === 'tooYoung' || fit === 'tooOld') && chosen !== null && (
        <div
          id="student-level-warning"
          className="flex flex-col gap-2 rounded bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <p>
            {t(fit === 'tooYoung' ? 'students.ageWarnYoung' : 'students.ageWarnOld', {
              level: chosen.name,
            })}
          </p>
          {/*
            Acknowledged in the app's own words, not the browser's — F-16.

            This was a native `required` checkbox, so an unticked box produced
            the browser's built-in bubble: "Please check this box if you want to
            proceed", in English, in a Portuguese interface, with no way to
            translate it. The rule is unchanged — the form cannot be submitted
            with the mismatch unacknowledged, and it is still a tick rather than
            a wall — but the refusal now comes from the action and lands beside
            the box like every other field error here.

            The hidden input is what tells the action a mismatch is on screen at
            all. Without it the server would have to re-derive "does this level
            fit this date", which is a second implementation of `fitsLevel`.
          */}
          <input type="hidden" name="levelAgeMismatch" value="1" />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="ageConfirmed"
              value="yes"
              className="size-4 accent-primary"
              aria-describedby={error === undefined ? undefined : 'student-age-confirm-error'}
            />
            {t('students.ageConfirm')}
          </label>
          {error !== undefined && (
            <p id="student-age-confirm-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * *Identificação e morada* — POOLSE-131 (Rui, 30-10-2026). All optional, the
 * student's own: what the FPN's Anexo 2 and the boletim de sócio fill from.
 * Folded by default and open once anything is on file, so a club that never
 * uses it never scrolls past it. The SNS number is owner and admin only: a
 * reader who may not see it gets no box, and posting the form then leaves the
 * number on file untouched (the API keeps it unless the field is sent).
 */
function IdentityFields({
  identity,
  fieldError,
  only,
}: {
  identity: StudentIdentity | undefined;
  fieldError: (name: string) => { error?: string };
  /** Which of the identity fields, in the order the form places them. */
  only: readonly (keyof StudentIdentity)[];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  /*
   * Country names come from Intl, whose data differs between Node and the
   * browser ("Chéquia" / "República Checa"), so the full list is built only in
   * the browser: the server and the first client render show the stored code
   * alone, and the names arrive after mounting — no hydration mismatch.
   */
  const [countries, setCountries] = useState<{ value: string; label: string }[]>(() =>
    identity?.nationality ? [{ value: identity.nationality, label: identity.nationality }] : [],
  );
  useEffect(() => setCountries(countryOptions(locale)), [locale]);
  // The number is withheld from this reader when the API says one is on file
  // but sends none.
  const snsHidden = identity?.snsRecorded === true && identity.snsNumber === null;

  const fields: Partial<Record<keyof StudentIdentity, React.ReactNode>> = {
    addressLine: (
      <TextField
        name="addressLine"
        label={t('students.identity.addressLine')}
        initial={identity?.addressLine ?? ''}
        autoComplete="street-address"
        maxLength={200}
        className="max-w-none sm:col-span-2"
        {...fieldError('addressLine')}
      />
    ),
    postalCode: (
      <TextField
        name="postalCode"
        inputMode="numeric"
        label={t('students.identity.postalCode')}
        initial={identity?.postalCode ?? ''}
        autoComplete="postal-code"
        maxLength={8}
        className="max-w-none"
        {...fieldError('postalCode')}
      />
    ),
    locality: (
      <TextField
        name="locality"
        label={t('students.identity.locality')}
        initial={identity?.locality ?? ''}
        autoComplete="address-level2"
        maxLength={100}
        className="max-w-none"
        {...fieldError('locality')}
      />
    ),
    birthplace: (
      <TextField
        name="birthplace"
        label={t('students.identity.birthplace')}
        initial={identity?.birthplace ?? ''}
        maxLength={120}
        className="max-w-none"
        {...fieldError('birthplace')}
      />
    ),
    nationality: (
      <SelectField
        name="nationality"
        label={t('students.identity.nationality')}
        initial={identity?.nationality ?? ''}
        options={[{ value: '', label: t('students.identity.notRecorded') }, ...countries]}
        className="max-w-none"
        {...fieldError('nationality')}
      />
    ),
    parentOneName: (
      <TextField
        name="parentOneName"
        label={t('students.identity.parentOneName')}
        initial={identity?.parentOneName ?? ''}
        maxLength={160}
        className="max-w-none"
        {...fieldError('parentOneName')}
      />
    ),
    parentTwoName: (
      <TextField
        name="parentTwoName"
        label={t('students.identity.parentTwoName')}
        initial={identity?.parentTwoName ?? ''}
        maxLength={160}
        className="max-w-none"
        {...fieldError('parentTwoName')}
      />
    ),
    maritalStatus: (
      <SelectField
        name="maritalStatus"
        label={t('students.identity.maritalStatus')}
        initial={identity?.maritalStatus ?? ''}
        options={[
          { value: '', label: t('students.identity.notRecorded') },
          ...(['single', 'married', 'civil_union', 'divorced', 'widowed'] as const).map((value) => ({
            value,
            label: t(`students.identity.marital.${value}`),
          })),
        ]}
        className="max-w-none"
        {...fieldError('maritalStatus')}
      />
    ),
    profession: (
      <TextField
        name="profession"
        label={t('students.identity.profession')}
        initial={identity?.profession ?? ''}
        maxLength={120}
        className="max-w-none"
        {...fieldError('profession')}
      />
    ),
    education: (
      <TextField
        name="education"
        label={t('students.identity.education')}
        initial={identity?.education ?? ''}
        maxLength={120}
        className="max-w-none"
        {...fieldError('education')}
      />
    ),
    snsNumber: snsHidden ? (
      <p className="text-sm text-foreground-muted">{t('students.identity.snsRecorded')}</p>
    ) : (
      <TextField
        name="snsNumber"
        inputMode="numeric"
        label={t('students.identity.snsNumber')}
        initial={identity?.snsNumber ?? ''}
        maxLength={11}
        hint={t('students.identity.snsHint')}
        className="max-w-none"
        {...fieldError('snsNumber')}
      />
    ),
  };
  return <>{only.map((name) => <Fragment key={name}>{fields[name]}</Fragment>)}</>;
}

/**
 * The ID document on the General tab — Rui, 30-10-2026: the same fields as
 * *Documentos*, so a number typed in either place is the one both show. The
 * number is the full one, read for owner and admin only (each read is in the
 * activity log); the originals ride along hidden, so a save that changed none
 * of them writes nothing to the document.
 */
function IdDocumentFields({
  idDocument,
  fieldError,
}: {
  idDocument: StudentIdDocument | null | undefined;
  fieldError: (name: string) => { error?: string };
}): React.ReactElement | null {
  const t = useTranslations();
  if (idDocument === undefined) return null;
  const doc = idDocument ?? { type: null, number: null, issuedOn: null, validUntil: null };
  return (
    <>
      <input type="hidden" name="idDocumentPresent" value="1" />
      <input type="hidden" name="idDocumentTypeWas" value={doc.type ?? ''} />
      <input type="hidden" name="idDocumentNumberWas" value={doc.number ?? ''} />
      <input type="hidden" name="idDocumentIssuedOnWas" value={doc.issuedOn ?? ''} />
      <input type="hidden" name="idDocumentValidUntilWas" value={doc.validUntil ?? ''} />
      <SelectField
        name="idDocumentType"
        label={t('documents.idDocument.type')}
        initial={doc.type ?? ''}
        options={[
          { value: '', label: t('documents.idDocument.typeNone') },
          ...(['cc', 'bi', 'passport', 'other'] as const).map((type) => ({
            value: type,
            label: t(`documents.idDocument.types.${type}`),
          })),
        ]}
        className="max-w-none"
        {...fieldError('idDocumentType')}
      />
      <TextField
        name="idDocumentNumber"
        label={t('documents.idDocument.number')}
        initial={doc.number ?? ''}
        autoComplete="off"
        maxLength={30}
        className="max-w-none"
        {...fieldError('idDocumentNumber')}
      />
      <TextField
        name="idDocumentIssuedOn"
        type="date"
        label={t('documents.idDocument.issuedOn')}
        initial={doc.issuedOn ?? ''}
        hint={t('documents.idDocument.issuedOnHint')}
        className="max-w-none"
        {...fieldError('idDocumentIssuedOn')}
      />
      <TextField
        name="idDocumentValidUntil"
        type="date"
        label={t('documents.idDocument.validUntil')}
        initial={doc.validUntil ?? ''}
        className="max-w-none"
        {...fieldError('idDocumentValidUntil')}
      />
    </>
  );
}
