'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Siren } from 'lucide-react';
import { TextAreaField, TextField } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { useSavedAction } from '@/lib/saved';
import { formatDate, formatStamp, formatTime } from '@/lib/date-format';
import type { TenantSupport } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { overrideSupportAction, requestSupportAction } from '@/app/(app)/dashboard/support.actions';
import { EnterSupportButton } from '../../enter-support-button';

const INITIAL: FormState = { ok: false };

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 self-start rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const DANGER =
  'inline-flex h-control items-center justify-center gap-2 self-start rounded border border-danger/50 px-4 text-control font-medium text-danger hover:bg-danger/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger';

/**
 * Support for one club — POOLSE-79, on `/admin/tenants/[id]`.
 *
 * Three states. A window is open, so *Entrar*. A request is waiting on the
 * Owner, so it says so. Otherwise *Pedir acesso*, with a sentence of reason,
 * and, behind a dialog that asks for the club's name, *Acesso de emergência*.
 */
export function SupportCard({
  tenantId,
  tenantName,
  support,
}: {
  tenantId: string;
  tenantName: string;
  support: TenantSupport;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium">{t('admin.support.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('admin.support.explain')}</p>
      </div>

      {support.live !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm">
            {t(`support.source.${support.live.source}`)}
            {' · '}
            {t('admin.support.until', {
              time: formatTime(support.live.expiresAt),
              date: formatDate(support.live.expiresAt),
            })}
          </p>
          <EnterSupportButton grantId={support.live.grantId} club={tenantName} />
        </div>
      ) : support.pendingRequest !== null ? (
        <p className="text-sm">
          {t('admin.support.waiting', { date: formatStamp(support.pendingRequest.requestedAt) })}
        </p>
      ) : (
        <>
          <RequestForm tenantId={tenantId} />
          <OverrideButton tenantId={tenantId} tenantName={tenantName} />
        </>
      )}
    </section>
  );
}

function RequestForm({ tenantId }: { tenantId: string }) {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(requestSupportAction, INITIAL);
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <TextAreaField
        name="reason"
        label={t('admin.support.reason')}
        hint={t('admin.support.reasonHint')}
        initial=""
        required
        maxLength={500}
        rows={2}
        error={state.fields?.['reason']}
      />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t('common.working') : t('admin.support.request')}
      </button>
    </form>
  );
}

/**
 * The 08:00 case. Behind a dialog because entering a club without its consent
 * is the act that feels irreversible, so it asks for the club's name as a
 * suspension does — POOLSE-64. Four hours, an alert, a notice to the Owner.
 */
function OverrideButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useSavedAction(overrideSupportAction, INITIAL);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={DANGER}>
        <Siren aria-hidden className="size-4" />
        {t('admin.support.override')}
      </button>
      <Dialog
        open={open && !state.ok}
        onClose={() => setOpen(false)}
        title={t('admin.support.override')}
        closeLabel={t('common.close')}
      >
        <form action={dispatch} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <p className="text-sm">{t('admin.support.overrideExplain')}</p>
          <TextAreaField
            name="reason"
            label={t('admin.support.reason')}
            hint={t('admin.support.overrideReasonHint')}
            initial=""
            required
            maxLength={500}
            rows={3}
            error={state.fields?.['reason']}
          />
          <TextField
            name="confirmName"
            label={t('admin.action.confirmName', { name: tenantName })}
            initial=""
            required
            autoComplete="off"
            error={state.fields?.['confirmName']}
            hint={t('admin.action.confirmNameHint')}
          />
          <button type="submit" disabled={pending} className={DANGER}>
            {pending ? t('common.working') : t('admin.support.overrideConfirm')}
          </button>
        </form>
      </Dialog>
    </>
  );
}
