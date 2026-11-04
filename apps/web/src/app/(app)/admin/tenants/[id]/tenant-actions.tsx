'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, Lock, LockOpen, Pencil, Receipt, Wallet } from 'lucide-react';
import { SelectField, TextAreaField, TextField, useSeeded } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { BASE_SPORT, POOLSE_MODULES, type PoolseModule } from '@poolse/rules';
import { useSavedAction } from '@/lib/saved';
import type { PlatformTenant, PlatformTenantAi, PlatformTenantAiPeriod, PlatformTenantAiReader, PlatformTenantSport } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { formatDate, formatStamp } from '@/lib/date-format';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '@/components/confirm-action';
import {
  recordPaymentAction,
  setAiAction,
  setBillingModeAction,
  setModulesAction,
  setSportsAction,
  setPlanAction,
  setReadOnlyAction,
  setSubscriptionAction,
  setSuspensionAction,
  setTrialAction,
} from '../../actions';

/**
 * A field error is a catalogue key (the API's and this app's alike) — shown
 * translated, never as the raw key. 13-10-2026 sweep.
 */
function fieldText(t: ReturnType<typeof useTranslations>, key: string | undefined): string | undefined {
  return key === undefined ? undefined : t(key);
}

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

export function TenantActions({
  tenant,
  ai = null,
}: {
  tenant: PlatformTenant;
  /** POOLSE-137: the AI readers' ticks and use; null when it could not be read. */
  ai?: PlatformTenantAi | null;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t('admin.actions')}</h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TrialCard tenant={tenant} />
        <SubscriptionCard tenant={tenant} />
        <BillingModeCard tenant={tenant} />
        <PaymentCard tenant={tenant} />
        <PlanCard tenant={tenant} />
        <ReadOnlyCard tenant={tenant} />
        <SuspensionCard tenant={tenant} />
        <ModulesCard tenant={tenant} />
        <SportsCard tenant={tenant} />
        <AiCard tenant={tenant} ai={ai} />
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
    <form action={action} className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
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
  confirm,
}: {
  label: string;
  pending: boolean;
  tone?: 'default' | 'danger';
  icon?: React.ReactNode;
  /** Asks first, then submits the card's own form (Rui, 04-11-2026). */
  confirm?: { title: string; message: string; confirmLabel: string; tone: 'primary' | 'danger' };
}): React.ReactElement {
  const t = useTranslations();
  const className = cn(
    'inline-flex h-control items-center justify-center gap-2 self-start rounded px-4 text-control font-medium disabled:opacity-60',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
    tone === 'danger'
      ? 'bg-destructive text-destructive-foreground outline-danger hover:bg-destructive/90'
      : 'bg-primary text-primary-foreground outline-primary hover:bg-primary/90 font-semibold',
  );

  if (confirm !== undefined) {
    return (
      <ConfirmButton {...confirm} disabled={pending} className={className}>
        {icon}
        {pending ? t('common.working') : label}
      </ConfirmButton>
    );
  }

  return (
    <button type="submit" disabled={pending} className={className}>
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
        error={fieldText(t, state.fields?.['endsAt'])}
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
        error={fieldText(t, state.fields?.['status'])}
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
        error={fieldText(t, state.fields?.['maxFacilities'])}
        hint={t('admin.action.facilitiesHint', { count: tenant.facilityCount })}
      />
      <TextField
        name="maxManagementUsers"
        label={t('admin.column.seats')}
        inputMode="numeric"
        initial={tenant.maxManagementUsers === null ? '' : String(tenant.maxManagementUsers)}
        error={fieldText(t, state.fields?.['maxManagementUsers'])}
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
 * Módulos — POOLSE-87. One box per module, ticked when it is on, with a line
 * under each saying what it covers so the switch is never a guess.
 *
 * Full width: eleven rows read as a list, and half a grid column would wrap
 * every description. Reversible, so no typed name — but it asks first (Rui,
 * 04-11-2026), saying what switching one off does to the club. A dependency
 * the operator would break (reception without invoicing) is refused by the API
 * and explained by the toast; nothing here switches a second module on the
 * operator's behalf.
 */
function ModulesCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(setModulesAction, INITIAL);

  return (
    <div className="md:col-span-2">
      <Card
        title={t('admin.modules.title')}
        hint={t('admin.modules.hint')}
        action={dispatch}
        tenantId={tenant.id}
      >
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {POOLSE_MODULES.map((module) => (
            <ModuleSwitch
              key={module}
              module={module}
              on={!tenant.disabledModules.includes(module)}
            />
          ))}
        </ul>
        <Submit
          label={t('common.save')}
          pending={pending}
          confirm={{
            title: t('confirm.instalacoes.modulesTitle', { club: tenant.name }),
            message: t('confirm.instalacoes.modulesMessage'),
            confirmLabel: t('common.save'),
            tone: 'primary',
          }}
        />
      </Card>
    </div>
  );
}

function ModuleSwitch({ module, on }: { module: PoolseModule; on: boolean }): React.ReactElement {
  const t = useTranslations();
  // Controlled, re-seeded when the server's answer changes — field.tsx's rule.
  const [checked, setChecked] = useSeeded(on);

  return (
    <li>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="enabled"
          value={module}
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t(`modules.name.${module}`)}</span>
          <span className="text-sm text-foreground-muted">{t(`modules.covers.${module}`)}</span>
        </span>
      </label>
    </li>
  );
}

/**
 * Desportos — POOLSE-124. One box per sport, ticked when it is on, with the
 * club's live recintos of it and what it adds to the subscription beside each.
 * The pool is always on, so its box is ticked and cannot be cleared. A sport
 * with live recintos cannot be switched off; the toast names them, and nothing
 * here archives a club's courts on the operator's behalf.
 */
function SportsCard({ tenant }: { tenant: PlatformTenant }): React.ReactElement {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(setSportsAction, INITIAL);

  return (
    <div className="md:col-span-2">
      <Card title={t('admin.sports.title')} hint={t('admin.sports.hint')} action={dispatch} tenantId={tenant.id}>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {tenant.sports.map((sport) => (
            <SportSwitch key={sport.sport} sport={sport} />
          ))}
        </ul>
        <Submit
          label={t('common.save')}
          pending={pending}
          confirm={{
            title: t('confirm.instalacoes.sportsTitle', { club: tenant.name }),
            message: t('confirm.instalacoes.sportsMessage'),
            confirmLabel: t('common.save'),
            tone: 'primary',
          }}
        />
      </Card>
    </div>
  );
}

function SportSwitch({ sport }: { sport: PlatformTenantSport }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const base = sport.sport === BASE_SPORT;
  const [checked, setChecked] = useSeeded(sport.enabled || base);

  return (
    <li>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="sport"
          value={sport.sport}
          checked={checked}
          disabled={base}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t(`sport.name.${sport.sport}`)}</span>
          <span className="text-sm text-foreground-muted">
            {base
              ? t('admin.sports.alwaysOn')
              : sport.addonMonthlyCents === null
                ? t('admin.sports.unpriced')
                : t('admin.sports.price', { amount: formatCents(locale, sport.addonMonthlyCents) })}
            {' · '}
            {t('admin.sports.recintos', { count: sport.recintos })}
          </span>
        </span>
      </label>
    </li>
  );
}

/**
 * Leitura com IA — POOLSE-137. One row per reader: the club's tick, its use this
 * month and last, failures, when it was last used and what it is estimated to
 * have cost. A reader ticked here but switched off for the platform says so on
 * its row, so it never looks as though it runs. The cap is one number for all
 * five. The cost is an estimate from the tokens and the model's list price —
 * labelled as one, `—` when the model has no price — and never shown to the club.
 */
function AiCard({ tenant, ai }: { tenant: PlatformTenant; ai: PlatformTenantAi | null }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(setAiAction, INITIAL);

  if (ai === null) {
    return (
      <section className="flex flex-col gap-1 rounded bg-surface p-4 md:col-span-2 shadow-card">
        <h3 className="text-sm font-medium">{t('admin.ai.title')}</h3>
        <p className="text-sm text-foreground-muted">{t('admin.ai.loadFailed')}</p>
      </section>
    );
  }

  return (
    <div className="md:col-span-2">
      <Card title={t('admin.ai.title')} hint={t('admin.ai.hint')} action={dispatch} tenantId={tenant.id}>
        <table className="table-stack w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="py-2 pr-3 font-medium">{t('admin.ai.reader')}</th>
              <th className="py-2 pr-3 font-medium">{t('admin.ai.thisMonth')}</th>
              <th className="py-2 pr-3 font-medium">{t('admin.ai.lastMonth')}</th>
              <th className="py-2 pr-3 font-medium">{t('admin.ai.lastUsed')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ai.readers.map((row) => (
              <AiReaderRow key={row.reader} row={row} />
            ))}
          </tbody>
        </table>
        <p className="text-sm text-foreground-muted">{t('admin.ai.estimateNote')}</p>
        <TextField
          name="monthlyCap"
          label={t('admin.ai.cap')}
          inputMode="numeric"
          initial={ai.monthlyCap === null ? '' : String(ai.monthlyCap)}
          error={fieldText(t, state.fields?.['monthlyCap'])}
          hint={t('admin.ai.capHint', { used: ai.usedThisMonth })}
        />
        <Submit
          label={t('common.save')}
          pending={pending}
          confirm={{
            title: t('confirm.instalacoes.aiTitle', { club: tenant.name }),
            message: t('confirm.instalacoes.aiMessage'),
            confirmLabel: t('common.save'),
            tone: 'primary',
          }}
        />
      </Card>
    </div>
  );
}

function AiReaderRow({ row }: { row: PlatformTenantAiReader }): React.ReactElement {
  const t = useTranslations();
  const [checked, setChecked] = useSeeded(row.ticked);

  return (
    <tr className="align-top">
      <td className="py-2 pr-3" data-label={t('admin.ai.reader')}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="reader"
            value={row.reader}
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium">{t(`admin.ai.name.${row.reader}`)}</span>
            <span className="text-foreground-muted">{t(`admin.ai.covers.${row.reader}`)}</span>
            {!row.platformOn && <span className="text-warning">{t('admin.ai.platformOff')}</span>}
          </span>
        </label>
      </td>
      <td className="py-2 pr-3" data-label={t('admin.ai.thisMonth')}>
        <AiPeriod period={row.thisMonth} />
      </td>
      <td className="py-2 pr-3" data-label={t('admin.ai.lastMonth')}>
        <AiPeriod period={row.lastMonth} />
      </td>
      <td className="py-2 pr-3" data-label={t('admin.ai.lastUsed')}>
        {row.lastUsedAt === null ? t('admin.ai.never') : formatStamp(row.lastUsedAt)}
      </td>
    </tr>
  );
}

function AiPeriod({ period }: { period: PlatformTenantAiPeriod }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <span className="flex flex-col gap-0.5">
      <span>{t('admin.ai.reads', { count: period.reads, failed: period.failed })}</span>
      {period.reads > 0 && (
        <span className="text-foreground-muted">
          {period.estimatedCents === null
            ? t('admin.ai.costUnpriced')
            : t('admin.ai.cost', { amount: formatCents(locale, period.estimatedCents) })}
          {period.measured < period.reads && ` · ${t('admin.ai.coverage', { measured: period.measured, reads: period.reads })}`}
        </span>
      )}
    </span>
  );
}

/**
 * Suspend, behind a confirmation with a reason. Restore asks too, but plainly.
 *
 * Closing a club's door is the one act in this product that feels irreversible
 * to the person it happens to, and it is worth a reason and a second press.
 * Opening it again is undoing harm and needs no reason — but since Rui's rule
 * of 04-11-2026 nothing is done or undone without being asked first.
 *
 * `components/ui/dialog.tsx`, never `window.confirm`: two confirmations in two
 * visual languages make an operator wonder whether they are being asked the same
 * thing. And never rendered in place of its own trigger.
 */
/**
 * Read-only — POOLSE-61, and the operator's hand on the state the clock will set.
 *
 * **A plain question, unlike suspension.** Shutting a club is destructive to
 * their day and gets a reason; putting one into read-only is what happens on
 * its own the day a trial ends, so it only asks once (Rui, 04-11-2026) — and
 * with a deletion date, the typed club name is the question.
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
  // Whether a deletion date has been typed, which is what turns this card from
  // one click into an act that asks for the club's name.
  const [keptUntil, setKeptUntil] = useState('');

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
          confirm={{
            title: t('confirm.instalacoes.writeRestoreTitle', { club: tenant.name }),
            message: t('confirm.instalacoes.writeRestoreMessage'),
            confirmLabel: t('admin.action.writeRestore'),
            tone: 'primary',
          }}
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
        onValueChange={setKeptUntil}
        error={fieldText(t, state.fields?.['dataKeptUntil'])}
        hint={t('admin.action.dataKeptUntilHint')}
      />

      {/*
        A deletion date is the irreversible half of this card, so it is the half
        that asks for the name — POOLSE-64 AC 3, and Rui's call on which acts
        count. Read-only on its own is what happens by itself the day a trial
        ends and an operator setting it by hand is usually correcting something;
        scheduling the end of a club's data is the other kind of act.

        Appearing with the date rather than standing there empty is the point: a
        field that is only sometimes required has to say when, and it says it by
        arriving. The API decides the same thing from the columns, so a client
        that never renders this is refused rather than obeyed.
      */}
      {keptUntil !== '' && (
        <TextField
          name="confirmName"
          label={t('admin.action.confirmName', { name: tenant.name })}
          initial=""
          required
          autoComplete="off"
          error={fieldText(t, state.fields?.['confirmName'])}
          hint={t('admin.action.confirmNameHint')}
        />
      )}

      <Submit
        label={t('admin.action.makeReadOnly')}
        pending={pending}
        icon={<Eye className="size-4" aria-hidden />}
        // With a deletion date the typed name is the question; without one,
        // the dialog is (Rui, 04-11-2026).
        {...(keptUntil === ''
          ? {
              confirm: {
                title: t('confirm.instalacoes.readOnlyTitle', { club: tenant.name }),
                message: t('confirm.instalacoes.readOnlyMessage'),
                confirmLabel: t('admin.action.makeReadOnly'),
                tone: 'danger' as const,
              },
            }
          : {})}
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
          confirm={{
            title: t('confirm.instalacoes.reopenTitle', { club: tenant.name }),
            message: t('confirm.instalacoes.reopenMessage'),
            confirmLabel: t('admin.action.restore'),
            tone: 'primary',
          }}
        />
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
        <div>
          <h3 className="text-sm font-medium">{t('admin.action.suspension')}</h3>
          <p className="text-sm text-foreground-muted">{t('admin.action.suspendHint')}</p>
        </div>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded-sm border border-danger/40 bg-danger/10 font-medium text-danger hover:border-danger/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
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
            error={fieldText(t, state.fields?.['reason'])}
            hint={t('admin.action.reasonHint')}
          />

          {/*
            And the club's name, typed — POOLSE-64 AC 3.

            The friction that matters is *reading the name and typing it*: being
            sure, while doing it, which club is about to lose its morning. So the
            name is on the dialog above this box, capitals and all, and the API
            accepts it case-insensitively — refusing over a capital would only
            teach somebody to paste it, which removes the reading.

            The check is the API's, not this form's. A dialog is the half a
            client can skip.
          */}
          <TextField
            name="confirmName"
            label={t('admin.action.confirmName', { name: tenant.name })}
            initial=""
            required
            autoComplete="off"
            error={fieldText(t, state.fields?.['confirmName'])}
            hint={t('admin.action.confirmNameHint')}
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
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card"
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
        error={fieldText(t, state.fields?.['billingMode'])}
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
        error={fieldText(t, state.fields?.['amount'] ?? state.fields?.['amountCents'])}
        hint={t('admin.action.amountHint')}
      />
      <TextField
        name="receivedOn"
        type="date"
        label={t('admin.action.receivedOn')}
        initial={today()}
        error={fieldText(t, state.fields?.['receivedOn'])}
      />
      <SelectField
        name="method"
        label={t('admin.action.method')}
        initial="bank_transfer"
        error={fieldText(t, state.fields?.['method'])}
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
        error={fieldText(t, state.fields?.['coversFrom'])}
        hint={t('admin.action.coversFromHint')}
      />
      <TextField
        name="coversTo"
        type="date"
        label={t('admin.action.coversTo')}
        initial=""
        error={fieldText(t, state.fields?.['coversTo'])}
        hint={t('admin.action.coversToHint')}
      />
      <TextAreaField
        name="note"
        label={t('admin.action.paymentNote')}
        initial=""
        error={fieldText(t, state.fields?.['note'])}
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
