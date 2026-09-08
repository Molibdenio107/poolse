'use client';

import { useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import {
  CONTROL_BLOCK,
  CONTROL_LINE,
  FIELD_COLUMN,
  FIELD_LABEL,
  TextField,
} from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { ConsentKind, EmergencyContact } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';
import {
  recordConsentAction,
  saveEmergencyContactAction,
  saveNotesAction,
  withdrawConsentAction,
} from './sensitive.actions';

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

/**
 * The medical notes box.
 *
 * Encrypted before it reaches the database and decrypted only for the people
 * allowed to see it — but on this screen it is just a textarea, and it should
 * be: an instructor checking whether a child is asthmatic before a lesson should
 * not have to think about any of that.
 */
export function MedicalNotesForm({
  organizationId,
  studentId,
  notes,
  mobilityNotes,
}: {
  organizationId: string;
  studentId: string;
  notes: string | null;
  /**
   * Mobility and physical limitations — POOLSE-23 AC3.
   *
   * In the same form and under the same Save, because they are one decision
   * about one person and two panels would mean two saves for what an operator
   * thinks of as filling in a record.
   */
  mobilityNotes: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(saveNotesAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      <label htmlFor="medicalNotes" className="text-sm font-medium">
        {t('sensitive.medicalLabel')}
      </label>
      <textarea
        id="medicalNotes"
        name="medicalNotes"
        rows={5}
        maxLength={4000}
        defaultValue={notes ?? ''}
        placeholder={t('sensitive.notesPlaceholder')}
        className={CONTROL_BLOCK}
      />
      <p className="text-sm text-foreground-muted">{t('sensitive.notesHint')}</p>

      <label htmlFor="mobilityNotes" className="mt-2 text-sm font-medium">
        {t('sensitive.mobilityLabel')}
      </label>
      <textarea
        id="mobilityNotes"
        name="mobilityNotes"
        rows={4}
        maxLength={4000}
        defaultValue={mobilityNotes ?? ''}
        placeholder={t('sensitive.mobilityPlaceholder')}
        className={CONTROL_BLOCK}
      />
      {/* Visible text rather than a tooltip: who can see this is exactly what
          somebody hesitates over before typing it. */}
      <p className="text-sm text-foreground-muted">{t('sensitive.mobilityHint')}</p>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>
      </div>

      <Problem state={state} />
    </form>
  );
}

/**
 * Recording a decision, not ticking a box.
 *
 * Granted and refused are both submit buttons, so the operator states which one
 * happened rather than leaving a default to speak for a guardian. The evidence
 * field is what makes the record worth anything a year later — "signed form
 * 12/09", "email from the mother".
 */
export function RecordConsentForm({
  organizationId,
  studentId,
  kinds,
}: {
  organizationId: string;
  studentId: string;
  kinds: ConsentKind[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(recordConsentAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      <div className="flex flex-wrap gap-2">
        <select name="kind" aria-label={t('sensitive.kind')} className={cn(CONTROL_LINE, 'min-w-44')}>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`sensitive.kinds.${kind}`)}
            </option>
          ))}
        </select>
        <input
          name="evidenceNote"
          maxLength={500}
          aria-label={t('sensitive.evidence')}
          placeholder={t('sensitive.evidencePlaceholder')}
          className={cn(CONTROL_LINE, 'min-w-48 flex-1')}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="granted"
          value="true"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('sensitive.recordGranted')}
        </button>
        <button
          type="submit"
          name="granted"
          value="false"
          disabled={pending}
          className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted disabled:opacity-60"
        >
          {t('sensitive.recordRefused')}
        </button>
      </div>

      <Problem state={state} />
    </form>
  );
}

/**
 * Withdrawal, confirmed, because it is the only change a consent record allows —
 * and it cannot be undone. Correcting a mistake means withdrawing and recording
 * a new decision, which leaves both in the history where an auditor can see them.
 */
export function WithdrawConsentButton({
  organizationId,
  studentId,
  consentId,
}: {
  organizationId: string;
  studentId: string;
  consentId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useSavedAction(withdrawConsentAction, INITIAL);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('sensitive.withdraw')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="consentId" value={consentId} />
      <span className="text-sm text-foreground-muted">{t('sensitive.confirmWithdraw')}</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-danger/50 px-2 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
      >
        {pending ? t('common.working') : t('facilities.confirmArchive')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:bg-surface-muted"
      >
        {t('common.cancel')}
      </button>
    </form>
  );
}

/**
 * Who to call — POOLSE-23 AC3, and what this deliberately is not.
 *
 * **Naming somebody here grants them nothing**: no role, no login, no access to
 * this student's record, and no place in any guardian list. The form says so
 * out loud, because "contacto de emergência" sitting under a medical page looks
 * exactly like the guardian block one screen over, and an operator who assumes
 * it works the same way will use it to give somebody access they never get.
 *
 * A person already in the club **or** a name and a number, never both — the two
 * are alternatives and choosing one clears the other. A club with the person in
 * its system should link, because then the name stays right when they change it.
 */
export function EmergencyContactForm({
  organizationId,
  studentId,
  contact,
  people,
}: {
  organizationId: string;
  studentId: string;
  contact: EmergencyContact | null;
  /** Everybody in the club, for the link. Empty is fine — the free text remains. */
  people: { id: string; name: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(saveEmergencyContactAction, INITIAL);
  const [membershipId, setMembershipId] = useState(contact?.membershipId ?? '');

  const linked = membershipId !== '';
  const fields = state.fields ?? {};

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      <div className={cn(FIELD_COLUMN, 'max-w-none')}>
        <label htmlFor="emergency-person" className={FIELD_LABEL}>
          {t('sensitive.emergencyPerson')}
        </label>
        <select
          id="emergency-person"
          name="membershipId"
          value={membershipId}
          onChange={(event) => setMembershipId(event.target.value)}
          className={CONTROL_LINE}
        >
          <option value="">{t('sensitive.emergencyNotInClub')}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>

      {/*
        The typed pair, offered only when nobody is linked. Hidden rather than
        disabled: a box that cannot be filled and will be cleared on save is a
        box that should not be on the screen.
      */}
      {!linked && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            name="name"
            label={t('sensitive.emergencyName')}
            initial={contact?.membershipId === null ? (contact?.name ?? '') : ''}
            error={fields['name'] === undefined ? undefined : t(fields['name'])}
            className="max-w-none"
          />
          <TextField
            name="phone"
            label={t('sensitive.emergencyPhone')}
            initial={contact?.membershipId === null ? (contact?.phone ?? '') : ''}
            inputMode="tel"
            className="max-w-none"
          />
        </div>
      )}

      <TextField
        name="relationship"
        label={t('sensitive.emergencyRelationship')}
        initial={contact?.relationship ?? ''}
        hint={t('sensitive.emergencyRelationshipHint')}
        className="max-w-none"
      />

      <p className="text-sm text-foreground-muted">{t('sensitive.emergencyNotGuardian')}</p>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>
      </div>

      <Problem state={state} />
    </form>
  );
}
