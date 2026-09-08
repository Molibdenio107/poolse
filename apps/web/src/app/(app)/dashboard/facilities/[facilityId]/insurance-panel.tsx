'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { TextAreaField, TextField } from '@/components/ui/field';
import { centsToInput, formatCents, parseCents } from '@/lib/money';
import type { InsurancePolicy } from '@/lib/api';
import type { FormState } from '../../actions';
import { archivePolicyAction, savePolicyAction } from './insurance.actions';

/**
 * The apólices a club holds — the facility's half of the seguro.
 *
 * A club buys one policy a season and insures every swimmer under it. What a
 * *student* holds is a seguro fee line pointing at one of these, which gives
 * that student a period they are covered for; this panel is the other side.
 *
 * **The cost here is what the club pays its insurer**, not what a family pays.
 * The family's price is the seguro row on the price list, and the two are
 * usually the same number and never the same fact — a club adding a euro of
 * admin would otherwise have nowhere to put the difference.
 *
 * **The warnings are the server's answers, rendered.** `renewalDue` and
 * `expired` are computed in SQL against the database's own date and nothing
 * here recomputes them: a browser's clock is not the club's, and a policy that
 * looked live on one laptop and lapsed on another would be a support call
 * nobody could reproduce.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * How long a policy has left, as a sentence.
 *
 * Three states and each is a different thing to do: one that has lapsed means
 * the club's swimmers are uninsured today, one inside the window is a renewal
 * conversation, and the rest is a date. Colour never carries it alone — every
 * state has its own words and the two warnings carry an icon.
 */
function Expiry({ policy }: { policy: InsurancePolicy }): React.ReactElement {
  const t = useTranslations();

  if (policy.expired) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-danger">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        {t('insurance.expired', { days: Math.abs(policy.daysToExpiry) })}
      </span>
    );
  }

  if (policy.renewalDue) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-warning">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        {t('insurance.renewalDue', { days: policy.daysToExpiry })}
      </span>
    );
  }

  return (
    <span className="text-sm text-foreground-muted">
      {t('insurance.validUntil', { date: policy.validTo })}
    </span>
  );
}

export function InsurancePanel({
  facilityId,
  policies,
  canManage,
}: {
  facilityId: string;
  policies: InsurancePolicy[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState<InsurancePolicy | null>(null);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('insurance.title')}
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">{t('insurance.hint')}</p>
        </div>
      </div>

      {policies.length === 0 && <p className="text-sm text-foreground-muted">{t('insurance.none')}</p>}

      {policies.length > 0 && (
        <ul className="divide-y divide-border">
          {policies.map((policy) => (
            <li key={policy.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{policy.insurer}</p>
                  <p className="text-sm text-foreground-muted">
                    {t('insurance.numberIs', { number: policy.policyNumber })}
                  </p>
                  <p className="text-sm text-foreground-muted">
                    {t('insurance.period', { from: policy.validFrom, to: policy.validTo })}
                  </p>
                  {/* Visible text, not a tooltip: the operator needs both the
                      per-person cost and how many people are on it. */}
                  <p className="text-sm text-foreground-muted">
                    {t('insurance.costPer', {
                      amount: formatCents(locale, policy.costPerPersonCents),
                    })}
                    {' · '}
                    {t('insurance.covered', { count: policy.coveredCount })}
                  </p>
                  {policy.notes !== null && (
                    <p className="mt-1 whitespace-pre-line text-sm">{policy.notes}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Expiry policy={policy} />
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(editing === policy.id ? null : policy.id)}
                        aria-expanded={editing === policy.id}
                        className={BUTTON_QUIET}
                      >
                        <Pencil aria-hidden className="size-4" />
                        <span className="sr-only">{t('insurance.edit')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDropping(policy)}
                        className={BUTTON_QUIET}
                      >
                        <Trash2 aria-hidden className="size-4" />
                        <span className="sr-only">{t('insurance.archive')}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {canManage && editing === policy.id && (
                <PolicyForm
                  facilityId={facilityId}
                  policy={policy}
                  onDone={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (adding ? (
          <PolicyForm facilityId={facilityId} policy={null} onDone={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON_QUIET}>
            <Plus aria-hidden className="mr-1 inline size-4" />
            {t('insurance.add')}
          </button>
        ))}

      {dropping !== null && (
        <DropPolicy
          facilityId={facilityId}
          policy={dropping}
          onDone={() => setDropping(null)}
        />
      )}
    </section>
  );
}

function PolicyForm({
  facilityId,
  policy,
  onDone,
}: {
  facilityId: string;
  policy: InsurancePolicy | null;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [cost, setCost] = useState(
    policy === null ? '' : centsToInput(policy.costPerPersonCents),
  );

  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await savePolicyAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  // Parsed here so the boundary only ever carries integer cents.
  const cents = parseCents(cost);
  const fields = state.fields ?? {};

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      {policy !== null && <input type="hidden" name="policyId" value={policy.id} />}
      <input
        type="hidden"
        name="costPerPersonCents"
        value={cents === null ? '' : String(cents)}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="insurer"
          label={t('insurance.insurer')}
          initial={policy?.insurer ?? ''}
          error={fields['insurer'] === undefined ? undefined : t(fields['insurer'])}
          required
          className="max-w-none"
        />
        <TextField
          name="policyNumber"
          label={t('insurance.policyNumber')}
          initial={policy?.policyNumber ?? ''}
          error={fields['policyNumber'] === undefined ? undefined : t(fields['policyNumber'])}
          required
          className="max-w-none"
        />
        <TextField
          name="validFrom"
          type="date"
          label={t('insurance.validFrom')}
          initial={policy?.validFrom ?? ''}
          error={fields['validFrom'] === undefined ? undefined : t(fields['validFrom'])}
          required
          className="max-w-none"
        />
        <TextField
          name="validTo"
          type="date"
          label={t('insurance.validTo')}
          initial={policy?.validTo ?? ''}
          error={fields['validTo'] === undefined ? undefined : t(fields['validTo'])}
          required
          className="max-w-none"
        />
        {/*
          Controlled by this component rather than by the field, because the
          hidden cents field above is derived from it — the same shape the price
          list uses, so the boundary never sees a decimal.
        */}
        <TextField
          name="costDisplay"
          label={t('insurance.costPerPerson')}
          initial={cost}
          onValueChange={setCost}
          inputMode="decimal"
          hint={t('insurance.costPerPersonHint')}
          error={
            fields['costPerPersonCents'] === undefined
              ? undefined
              : t(fields['costPerPersonCents'])
          }
          required
          className="max-w-none"
        />
      </div>

      <TextAreaField
        name="notes"
        label={t('insurance.notes')}
        initial={policy?.notes ?? ''}
        rows={3}
        hint={t('insurance.notesHint')}
        className="max-w-none"
      />

      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey, state.values ?? {})}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('insurance.save')}
        </button>
        <button type="button" onClick={onDone} className={BUTTON_QUIET}>
          {t('insurance.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * Filing a policy away, asked in a dialog rather than in place.
 *
 * `components/ui/dialog.tsx` for the reason the convention gives: it portals to
 * the body, so no ancestor's overflow can clip it, and it closes on Escape and
 * on the backdrop with the focus round trip that comes with it.
 *
 * The refusal — a policy somebody is still covered by — arrives here as a count
 * and is said with it. "Não é possível arquivar" alone would leave an operator
 * with nothing to do next.
 */
function DropPolicy({
  facilityId,
  policy,
  onDone,
}: {
  facilityId: string;
  policy: InsurancePolicy;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await archivePolicyAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('insurance.archiveTitle')}
      closeLabel={t('insurance.cancel')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="policyId" value={policy.id} />

        <p className="text-sm">
          {t('insurance.archiveAsk', {
            insurer: policy.insurer,
            number: policy.policyNumber,
          })}
        </p>

        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('insurance.archive')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('insurance.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
