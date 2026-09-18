'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, Lock, LockOpen, Pencil, Receipt, Wallet } from 'lucide-react';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { useSavedAction } from '@/lib/saved';
import type { PlatformTenant } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import {
  recordPaymentAction,
  setBillingModeAction,
  setPlanAction,
  setReadOnlyAction,
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
        <BillingModeCard tenant={tenant} />
        <PaymentCard tenant={tenant} />
        <PlanCard tenant={tenant} />
        <ReadOnlyCard tenant={tenant} />
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

      {/*
        Conceder novo período — POOLSE-62, and the reason the hard block is
        allowed to be hard. One trial per address has no appeal inside the
        product, so a club that genuinely left and came back must cost one
        click rather than a support thread.

        On the date's own form rather than a second button: granting a fresh
        trial *is* a new date plus a freed address, and two controls would let
        somebody do half of it and let a club back in on a trial that ran out
        in March. Unchecked by default — freeing an address is never what
        "correct this date" means.
      */}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="releaseClaim"
          value="true"
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('admin.action.releaseClaim')}</span>
          <span className="text-sm text-foreground-muted">
            {t('admin.action.releaseClaimHint')}
          </span>
        </span>
      </label>

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
        /*
          `comped` is deliberately absent — POOLSE-63. A free pilot is a *mode*
          now, offered on the card below, because one fact with two homes is how
          the two come to disagree. `expired` is here because the clock can set
          it and an operator has to be able to correct it.
        */
        options={(['trialing', 'active', 'past_due', 'canceled', 'expired'] as const).map(
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
/**
 * Read-only — POOLSE-61, and the operator's hand on the state the clock will set.
 *
 * **Not a confirmation dialog, unlike suspension.** Shutting a club is
 * destructive to their day and gets asked twice; putting one into read-only is
 * what happens on its own the day a trial ends, and an operator doing it by hand
 * is usually correcting something. Making it harder than the automatic path would
 * be ceremony.
 *
 * **Lifting clears the deletion date**, said on the card rather than left to be
 * discovered: a club writing normally with a deletion still scheduled is the
 * worst of the two states and the one nobody thinks to check for.
 *
 * The date is optional. Thirty days is the ladder's number and B2's job will
 * apply it; an operator setting this by hand may have a reason with no deletion
 * attached at all, and a form that insisted would make them invent one.
 */
function ReadOnlyCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(setReadOnlyAction, INITIAL);

  if (tenant.readOnlyAt !== null) {
    return (
      <Card
        title={t('admin.action.readOnly')}
        hint={t('admin.action.writeRestoreHint')}
        action={dispatch}
        tenantId={tenant.id}
      >
        <input type="hidden" name="readOnly" value="false" />
        <Submit
          label={t('admin.action.writeRestore')}
          pending={pending}
          icon={<Pencil className="size-4" aria-hidden />}
        />
      </Card>
    );
  }

  return (
    <Card
      title={t('admin.action.readOnly')}
      hint={t('admin.action.readOnlyHint')}
      action={dispatch}
      tenantId={tenant.id}
    >
      <input type="hidden" name="readOnly" value="true" />
      <TextField
        name="dataKeptUntil"
        label={t('admin.action.dataKeptUntil')}
        type="date"
        initial=""
        error={state.fields?.['dataKeptUntil']}
        hint={t('admin.action.dataKeptUntilHint')}
      />
      <Submit
        label={t('admin.action.makeReadOnly')}
        pending={pending}
        icon={<Eye className="size-4" aria-hidden />}
      />
    </Card>
  );
}

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

/**
 * How this club pays — POOLSE-63.
 *
 * Beside the subscription status rather than folded into it, because they answer
 * different questions and move at different times. The paid-through date is
 * shown here and **is not a field**: it moves only because a payment was
 * recorded, since a date typed by hand is a date that disagrees with the money.
 */
function BillingModeCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(setBillingModeAction, INITIAL);

  return (
    <Card
      title={t('admin.action.billingMode')}
      hint={t('admin.action.billingModeHint')}
      action={dispatch}
      tenantId={tenant.id}
    >
      <SelectField
        name="billingMode"
        label={t('admin.action.billingMode')}
        initial={tenant.billingMode}
        error={state.fields?.['billingMode']}
        options={(['stripe', 'manual', 'comped'] as const).map((mode) => ({
          value: mode,
          label: t(`admin.billingMode.${mode}`),
        }))}
      />

      {/*
        Visible text, never a tooltip: what a club is paid up to is something the
        operator needs, and a tooltip may clarify a control but may never be the
        only place a fact appears.
      */}
      <p className="text-sm text-foreground-muted">
        {tenant.paidThrough === null
          ? t('admin.action.paidThroughNone')
          : t('admin.action.paidThrough', { date: formatDate(tenant.paidThrough) })}
      </p>

      <Submit label={t('common.save')} pending={pending} icon={<Wallet className="size-4" />} />
    </Card>
  );
}

/**
 * Record what actually arrived — POOLSE-63.
 *
 * **This is the only thing that moves `paidThrough`**, and recording one also
 * puts the club on manual, marks it active and lifts read-only. That is what the
 * money means, and doing it in one action is what stops the date and the receipt
 * disagreeing.
 *
 * The amount is typed the way every price in this product is typed — "120" or
 * "120,50" — and becomes cents in the action. A payment cannot be edited
 * afterwards: it is a claim about a moment, like a completion or an invoice, so
 * a correction is another row rather than a rewrite of this one.
 */
function PaymentCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(recordPaymentAction, INITIAL);

  return (
    <Card
      title={t('admin.action.payment')}
      hint={t('admin.action.paymentHint')}
      action={dispatch}
      tenantId={tenant.id}
    >
      <TextField
        name="amount"
        label={t('admin.action.amount')}
        inputMode="decimal"
        initial=""
        error={state.fields?.['amount'] ?? state.fields?.['amountCents']}
        hint={t('admin.action.amountHint')}
      />
      <TextField
        name="receivedOn"
        type="date"
        label={t('admin.action.receivedOn')}
        initial={today()}
        error={state.fields?.['receivedOn']}
      />
      <SelectField
        name="method"
        label={t('admin.action.method')}
        initial="bank_transfer"
        error={state.fields?.['method']}
        options={(['cash', 'bank_transfer', 'other'] as const).map((method) => ({
          value: method,
          label: t(`admin.method.${method}`),
        }))}
      />
      <TextField
        name="coversFrom"
        type="date"
        label={t('admin.action.coversFrom')}
        initial=""
        error={state.fields?.['coversFrom']}
        hint={t('admin.action.coversFromHint')}
      />
      <TextField
        name="coversTo"
        type="date"
        label={t('admin.action.coversTo')}
        initial=""
        error={state.fields?.['coversTo']}
        hint={t('admin.action.coversToHint')}
      />
      <TextAreaField
        name="note"
        label={t('admin.action.paymentNote')}
        initial=""
        error={state.fields?.['note']}
        rows={2}
      />
      <Submit
        label={t('admin.action.recordPayment')}
        pending={pending}
        icon={<Receipt className="size-4" />}
      />
    </Card>
  );
}

/** Today as `YYYY-MM-DD`, which is what a date input speaks. */
function today(): string {
  const at = new Date();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const date = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${date}`;
}
