'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, LockOpen } from 'lucide-react';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { useSavedAction } from '@/lib/saved';
import type { PlatformTenant } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { cn } from '@/lib/utils';
import {
  setPlanAction,
  setSubscriptionAction,
  setSuspensionAction,
  setTrialAction,
} from '../../actions';

/**
 * What an operator can change about a tenant — slice 3.
 *
 * **Four small forms rather than one.** They are four unrelated decisions, taken
 * at different moments for different reasons. A single Save across all of them
 * means adjusting a seat count and silently rewriting a trial date at the same
 * time, and it means one refusal blocking three changes that were fine.
 *
 * **Every field is controlled**, from `field.tsx`. React 19 resets a form as soon
 * as a function `action` returns — *including* when it returns a validation
 * error — so an uncontrolled input would wipe what the operator just typed at
 * the exact moment they are being asked to correct it. Two separate-looking bugs
 * shipped from that cause once (POOLSE-09, POOLSE-10) and this is the component
 * those fields exist for.
 *
 * **`<form action={dispatch}>`, not an onClick.** React hands the FormData over
 * itself, which keeps Enter-to-submit, keeps the button a real submit, and means
 * there is no click handler to forget on the next field somebody adds.
 *
 * **The save says so once**, through `useSavedAction`: one toast, one wording,
 * and nothing here has to remember to report an outcome. Field-level refusals
 * still land beside their field, because a message at the top of a panel cannot
 * say which of six boxes it meant.
 */

const INITIAL: FormState = { ok: false };

export function TenantActions({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t('admin.actions')}</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <TrialCard tenant={tenant} />
        <SubscriptionCard tenant={tenant} />
        <PlanCard tenant={tenant} />
        <SuspensionCard tenant={tenant} />
      </div>
    </section>
  );
}

function Card({
  title,
  hint,
  action,
  tenantId,
  children,
}: {
  title: string;
  hint: string;
  action: (payload: FormData) => void;
  tenantId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <form action={action} className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      {/* The subject, not the actor — see the note in actions.ts. */}
      <input type="hidden" name="tenantId" value={tenantId} />

      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-foreground-muted">{hint}</p>
      </div>

      {children}
    </form>
  );
}

function Submit({
  label,
  pending,
  tone = 'default',
  icon,
}: {
  label: string;
  pending: boolean;
  tone?: 'default' | 'danger';
  icon?: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'inline-flex h-control items-center gap-2 self-start rounded px-3 text-sm font-medium disabled:opacity-60',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        tone === 'danger'
          ? 'bg-danger text-white outline-danger hover:bg-danger/90'
          : 'bg-primary text-primary-foreground outline-primary hover:bg-primary/90',
      )}
    >
      {icon}
      {pending ? t('common.working') : label}
    </button>
  );
}

/** The date input speaks `YYYY-MM-DD`; the API speaks ISO instants. */
function asDateInput(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 10);
}

function TrialCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(setTrialAction, INITIAL);

  return (
    <Card
      title={t('admin.action.trial')}
      hint={t('admin.action.trialHint')}
      action={dispatch}
      tenantId={tenant.id}
    >
      <TextField
        name="endsAt"
        type="date"
        label={t('admin.action.trialEndsAt')}
        initial={asDateInput(tenant.trialEndsAt)}
        error={state.fields?.['endsAt']}
        hint={t('admin.action.trialPastHint')}
      />
      <Submit label={t('common.save')} pending={pending} />
    </Card>
  );
}

function SubscriptionCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(setSubscriptionAction, INITIAL);

  return (
    <Card
      title={t('admin.action.subscription')}
      hint={t('admin.action.subscriptionHint')}
      action={dispatch}
      tenantId={tenant.id}
    >
      <SelectField
        name="status"
        label={t('admin.column.status')}
        initial={tenant.subscriptionStatus}
        error={state.fields?.['status']}
        options={(['trialing', 'active', 'past_due', 'canceled', 'comped'] as const).map(
          (status) => ({ value: status, label: t(`admin.status.${status}`) }),
        )}
      />
      <Submit label={t('common.save')} pending={pending} />
    </Card>
  );
}

function PlanCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(setPlanAction, INITIAL);

  return (
    <Card
      title={t('admin.action.plan')}
      hint={t('admin.action.planHint')}
      action={dispatch}
      tenantId={tenant.id}
    >
      <TextField
        name="maxFacilities"
        label={t('admin.column.facilities')}
        inputMode="numeric"
        initial={String(tenant.maxFacilities ?? 1)}
        error={state.fields?.['maxFacilities']}
        hint={t('admin.action.facilitiesHint', { count: tenant.facilityCount })}
      />
      <TextField
        name="maxManagementUsers"
        label={t('admin.column.seats')}
        inputMode="numeric"
        initial={tenant.maxManagementUsers === null ? '' : String(tenant.maxManagementUsers)}
        error={state.fields?.['maxManagementUsers']}
        /*
          Empty means unlimited, said in the hint rather than left to be
          discovered. A blank box that silently means "no limit" is the kind of
          thing an operator clears by accident and nobody notices for a year.
        */
        hint={t('admin.action.seatsHint', { count: tenant.managementSeatsUsed })}
      />
      <Submit label={t('common.save')} pending={pending} />
    </Card>
  );
}

/**
 * Suspend, behind a confirmation. Restore, not.
 *
 * The asymmetry is the point: closing a club's door is the one act in this
 * product that feels irreversible to the person it happens to, and it is worth a
 * sentence and a second press. Opening it again is undoing harm and should be
 * one click — nothing is made safer by slowing down the safe direction.
 *
 * `components/ui/dialog.tsx`, never `window.confirm`: two confirmations in two
 * visual languages make an operator wonder whether they are being asked the same
 * thing. And never rendered in place of its own trigger.
 */
function SuspensionCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(setSuspensionAction, INITIAL);
  const [confirming, setConfirming] = useState(false);

  if (tenant.suspendedAt !== null) {
    return (
      <Card
        title={t('admin.action.suspension')}
        hint={t('admin.action.restoreHint')}
        action={dispatch}
        tenantId={tenant.id}
      >
        <input type="hidden" name="suspended" value="false" />

        {/*
          The reason on screen, not only in the database. Whoever restores a club
          three weeks later is usually not whoever closed it.
        */}
        {tenant.suspensionReason !== null && (
          <blockquote className="border-l-2 border-warning/50 pl-3 text-sm">
            {tenant.suspensionReason}
          </blockquote>
        )}

        <Submit
          label={t('admin.action.restore')}
          pending={pending}
          icon={<LockOpen className="size-4" aria-hidden />}
        />
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-medium">{t('admin.action.suspension')}</h3>
          <p className="text-sm text-foreground-muted">{t('admin.action.suspendHint')}</p>
        </div>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-control items-center gap-2 self-start rounded border border-danger/40 bg-danger/10 px-3 text-sm font-medium text-danger hover:border-danger/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          <Lock className="size-4" aria-hidden />
          {t('admin.action.suspend')}
        </button>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('admin.action.suspendConfirmTitle')}
        description={tenant.name}
        closeLabel={t('common.close')}
      >
        {/*
          The form lives inside the dialog, so the reason travels with the
          submit and there is no second copy of it in this component's state to
          fall out of step. The dialog stays open on a refusal — which is the
          whole reason the field is controlled: a 400 naming `reason` has to find
          the words still in the box.
        */}
        <form action={dispatch} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="suspended" value="true" />

          {/*
            What it does, in words, above the button. "Suspend" is vague enough
            to be read as "stop billing"; everyone at the club losing the
            register in the morning is the part worth spelling out.
          */}
          <p className="text-sm">{t('admin.action.suspendConfirmBody')}</p>

          <TextAreaField
            name="reason"
            label={t('admin.action.reason')}
            rows={3}
            maxLength={500}
            required
            error={state.fields?.['reason']}
            hint={t('admin.action.reasonHint')}
          />

          <div className="flex items-center gap-2">
            <Submit
              label={t('admin.action.suspend')}
              pending={pending}
              tone="danger"
              icon={<Lock className="size-4" aria-hidden />}
            />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-control rounded border border-border-strong px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
