'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { centsToInput } from '@/lib/money';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { recordPurchaseAction, recordServiceAction, savePremiumAction } from './cost.actions';

const INITIAL: FormState = { ok: false };
const SUBMIT =
  'inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';

type Action = (previous: FormState, data: FormData) => Promise<FormState>;

/** The sentence a field's refusal carries, translated. */
function useFieldErrors(state: FormState): (name: string) => string | undefined {
  const t = useTranslations();
  return (name) => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };
}

/** A button and its dialog, closing on a save. Each caller supplies the fields. */
function CostDialog({
  title,
  trigger,
  triggerClassName,
  action,
  children,
}: {
  title: string;
  trigger: string;
  triggerClassName: string;
  action: Action;
  children: (error: (name: string) => string | undefined) => React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useSavedAction(async (previous: FormState, data: FormData) => {
    const answer = await action(previous, data);
    if (answer.ok) setOpen(false);
    return answer;
  }, INITIAL);
  const error = useFieldErrors(state);
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} closeLabel={t('common.close')}>
        <form action={submit} className="flex flex-col gap-3">
          {children(error)}
          <button type="submit" disabled={pending} className={SUBMIT}>
            {pending ? t('common.working') : t('costs.record.save')}
          </button>
        </form>
      </Dialog>
    </>
  );
}

function Amounts({ error }: { error: (name: string) => string | undefined }): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField name="amount" label={t('costs.record.amount')} inputMode="decimal" required error={error('amount')} />
      <TextField name="vat" label={t('costs.record.vat')} inputMode="decimal" error={error('vat')} />
    </div>
  );
}

function Document(): React.ReactElement {
  const t = useTranslations();
  return (
    <>
      <TextField name="supplier" label={t('costs.record.supplier')} maxLength={200} />
      <TextField name="documentNumber" label={t('costs.record.documentNumber')} maxLength={100} />
    </>
  );
}

/** Materials bought: the stock rises with it. On an inventory row. */
export function RecordPurchase({
  itemId,
  itemName,
  className,
}: {
  itemId: string;
  itemName: string;
  className: string;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <CostDialog
      title={t('costs.record.purchaseTitle', { name: itemName })}
      trigger={t('costs.record.purchase')}
      triggerClassName={className}
      action={recordPurchaseAction}
    >
      {(error) => (
        <>
          <input type="hidden" name="itemId" value={itemId} />
          <TextField name="quantity" label={t('costs.record.quantity')} inputMode="numeric" required error={error('quantity')} />
          <Amounts error={error} />
          <TextField name="boughtOn" type="date" label={t('costs.record.boughtOn')} required error={error('boughtOn')} />
          <Document />
        </>
      )}
    </CostDialog>
  );
}

/** What a repair cost, on the avaria it was for. */
export function RecordService({ requestId, className }: { requestId: string; className: string }): React.ReactElement {
  const t = useTranslations();
  return (
    <CostDialog
      title={t('costs.record.serviceTitle')}
      trigger={t('costs.record.service')}
      triggerClassName={className}
      action={recordServiceAction}
    >
      {(error) => (
        <>
          <input type="hidden" name="requestId" value={requestId} />
          <Amounts error={error} />
          <TextField name="performedOn" type="date" label={t('costs.record.performedOn')} required error={error('performedOn')} />
          <Document />
        </>
      )}
    </CostDialog>
  );
}

/** A policy's premium, spread by day over the policy's dates. An empty box clears it. */
export function PremiumForm({
  facilityId,
  policyId,
  premiumCents,
  premiumVatCents,
}: {
  facilityId: string;
  policyId: string;
  premiumCents: number | null;
  premiumVatCents: number | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(savePremiumAction, INITIAL);
  const error = useFieldErrors(state);
  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="policyId" value={policyId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="premium"
          label={t('costs.record.premium')}
          inputMode="decimal"
          initial={premiumCents === null ? '' : centsToInput(premiumCents)}
          error={error('premium')}
        />
        <TextField
          name="vat"
          label={t('costs.record.vat')}
          inputMode="decimal"
          initial={premiumVatCents === null ? '' : centsToInput(premiumVatCents)}
          error={error('vat')}
        />
      </div>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? t('common.working') : t('costs.record.savePremium')}
      </button>
    </form>
  );
}
