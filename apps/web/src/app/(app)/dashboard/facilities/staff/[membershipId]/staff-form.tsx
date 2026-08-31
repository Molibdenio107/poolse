'use client';

import { useRef, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { Lock, Mail } from 'lucide-react';
import type { StaffRecord } from '@/lib/api';
import { TextField, TextAreaField, useFocusFirstError } from '@/components/ui/field';
import { RoleBadge } from '@/components/role-badge';
import type { FormState } from '../../../actions';
import {
  cancelReinviteAction,
  reinviteAction,
  saveStaffAction,
  setRoleAction,
} from './staff.actions';

const INITIAL: FormState = { ok: false };

/**
 * The staff record — POOLSE-39.
 *
 * **Email is shown, not hidden, and explained** (AC2). A disabled box with no
 * reason reads as a bug; the point is that the address *is* the login, so
 * changing it means moving the login — which is a different operation with
 * different consequences, and it says so.
 *
 * **Notes appear only for an owner or an admin.** They are frequently what a
 * manager writes *about* somebody rather than what that person writes about
 * themselves, and an instructor editing their own record should not find them.
 *
 * Fields are controlled and re-seed only when the server's value changes, so a
 * validation failure keeps what was typed — the standing rule from POOLSE-09,
 * and AC9 restates it.
 */
export function StaffForm({
  organizationId,
  staff,
  canManage,
  isOwner,
  grantable,
}: {
  organizationId: string;
  staff: StaffRecord;
  /** Owner or admin: may edit anybody, write notes, and change roles. */
  canManage: boolean;
  /** Only the owner may move somebody to a new address. */
  isOwner: boolean;
  /** The roles this person may hand out, from the POOLSE-01 matrix. */
  grantable: string[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, saving] = useSavedAction(saveStaffAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);

  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key);
  };

  return (
    <div className="flex flex-col gap-page-gap">
      <form
        ref={formRef}
        action={action}
        className="flex flex-col gap-4 rounded border border-border bg-surface p-5"
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="membershipId" value={staff.membershipId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="firstName"
            label={t('staff.firstName')}
            initial={staff.firstName ?? ''}
            error={error('firstName')}
            autoComplete="given-name"
            maxLength={120}
          />
          <TextField
            name="lastName"
            label={t('staff.lastName')}
            initial={staff.lastName ?? ''}
            error={error('lastName')}
            autoComplete="family-name"
            maxLength={120}
          />
          <TextField
            name="phone"
            type="tel"
            label={t('staff.phone')}
            initial={staff.phone ?? ''}
            error={error('phone')}
            autoComplete="tel"
            maxLength={40}
          />

          <ReadOnlyEmail email={staff.email} />
        </div>

        {canManage && (
          <TextAreaField
            name="notes"
            label={t('staff.notes')}
            initial={staff.notes ?? ''}
            hint={t('staff.notesHint')}
            maxLength={2000}
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
          >
            {saving ? t('common.working') : t('staff.save')}
          </button>
          {state.ok && <span className="text-sm text-success">{t('staff.saved')}</span>}
          {state.errorKey !== undefined && (
            <span className="text-sm text-danger">{t(state.errorKey)}</span>
          )}
        </div>
      </form>

      {canManage && (
        <RoleEditor
          organizationId={organizationId}
          staff={staff}
          grantable={grantable}
        />
      )}

      {isOwner && <Reinvite organizationId={organizationId} staff={staff} />}
    </div>
  );
}

/**
 * The address, and why it cannot be typed over — AC2.
 *
 * Not a disabled input. A greyed box invites somebody to try, fail, and wonder;
 * a field that plainly is not a field, with a sentence saying what to do
 * instead, answers the question before it is asked.
 */
function ReadOnlyEmail({ email }: { email: string | null }): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-foreground-muted">{t('staff.email')}</span>
      <p className="flex items-center gap-2 rounded border border-dashed border-border bg-surface-muted px-3 py-2">
        <Mail className="size-4 shrink-0 text-foreground-muted" aria-hidden />
        <span className="truncate">{email ?? '—'}</span>
        <Lock className="ml-auto size-3.5 shrink-0 text-foreground-muted" aria-hidden />
      </p>
      <p className="text-sm text-foreground-muted">{t('staff.emailReadOnly')}</p>
    </div>
  );
}

/**
 * Roles, added and removed one at a time — AC5, AC6.
 *
 * The list offered is what the POOLSE-01 matrix allows this person to grant, so
 * an admin never sees Owner. The API applies the same rule; hiding it here is
 * the courtesy, not the control.
 *
 * Each change is its own form rather than a batch, because they are refused
 * individually and a batch that half-succeeded would need a story nobody has
 * written.
 */
function RoleEditor({
  organizationId,
  staff,
  grantable,
}: {
  organizationId: string;
  staff: StaffRecord;
  grantable: string[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(setRoleAction, INITIAL);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('staff.roles')}
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        {staff.roles.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('staff.noRoles')}</p>
        ) : (
          staff.roles.map((role) => (
            <form key={role} action={action} className="inline-flex">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="membershipId" value={staff.membershipId} />
              <input type="hidden" name="role" value={role} />
              <input type="hidden" name="grant" value="false" />
              <button
                type="submit"
                disabled={pending || !grantable.includes(role)}
                title={
                  grantable.includes(role)
                    ? t('staff.removeRole', { role: t(`roles.${role}`) })
                    : t('staff.roleNotYours')
                }
                className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
              >
                <RoleBadge role={role} />
              </button>
            </form>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-sm text-foreground-muted">{t('staff.addRole')}</span>
        {grantable
          .filter((role) => !staff.roles.includes(role))
          .map((role) => (
            <form key={role} action={action} className="inline-flex">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="membershipId" value={staff.membershipId} />
              <input type="hidden" name="role" value={role} />
              <input type="hidden" name="grant" value="true" />
              <button
                type="submit"
                disabled={pending}
                className="rounded border border-dashed border-border px-2 py-0.5 text-sm text-foreground-muted hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
              >
                + {t(`roles.${role}`)}
              </button>
            </form>
          ))}
      </div>

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">{t(state.errorKey)}</p>
      )}
    </section>
  );
}

/**
 * Moving somebody to a new address — AC3, AC4.
 *
 * The pending state is shown on the record and can be cancelled. Their existing
 * login keeps working until the new address is accepted, which is the sentence
 * that makes this safe to press.
 */
function Reinvite({
  organizationId,
  staff,
}: {
  organizationId: string;
  staff: StaffRecord;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, sending] = useSavedAction(reinviteAction, INITIAL);
  const [, cancel, cancelling] = useSavedAction(cancelReinviteAction, INITIAL);

  if (staff.pendingInvite !== null) {
    return (
      <section className="flex flex-col gap-3 rounded border border-warning/40 bg-warning/10 p-5">
        <h2 className="font-medium">{t('staff.reinvitePending')}</h2>
        <p className="text-sm">
          {t('staff.reinvitePendingHint', { email: staff.pendingInvite.email })}
        </p>

        <form action={cancel} className="inline-flex">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="membershipId" value={staff.membershipId} />
          <button
            type="submit"
            disabled={cancelling}
            className="rounded border border-border px-4 py-2 text-sm disabled:opacity-60"
          >
            {cancelling ? t('common.working') : t('staff.reinviteCancel')}
          </button>
        </form>
      </section>
    );
  }

  if (!open) {
    return (
      <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('staff.changeEmail')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('staff.changeEmailHint')}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start rounded border border-border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('staff.reinvite')}
        </button>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="membershipId" value={staff.membershipId} />

      <h2 className="font-medium">{t('staff.changeEmail')}</h2>
      <p className="text-sm text-foreground-muted">{t('staff.reinviteExplains')}</p>

      <TextField
        name="email"
        type="email"
        label={t('staff.newEmail')}
        required
        maxLength={254}
        error={
          state.fields?.['email'] === undefined ? undefined : t(state.fields['email'] as string)
        }
        className="max-w-md"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={sending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {sending ? t('common.working') : t('staff.reinviteSend')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-border px-4 py-2"
        >
          {t('common.cancel')}
        </button>
      </div>

      {state.errorKey !== undefined && <p className="text-sm text-danger">{t(state.errorKey)}</p>}
    </form>
  );
}
