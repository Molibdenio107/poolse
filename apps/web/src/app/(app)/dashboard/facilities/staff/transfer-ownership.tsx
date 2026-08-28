'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { OrganizationMember } from '@/lib/api';
import type { FormState } from '../../actions';
import { transferOwnershipAction } from '../../actions';

const INITIAL: FormState = { ok: false };

/**
 * Handing the organization to somebody else.
 *
 * Folded shut by default, and two steps when opened. This is the one action in
 * Poolse that the person performing it cannot undo — after it, only the new
 * owner can transfer back — so it is deliberately more work to reach than
 * anything else on the screen.
 *
 * Only administrators are offered. Ownership is the licence; handing it to a
 * student is far more likely to be a misclick than an intention, and the API
 * refuses it anyway.
 */
export function TransferOwnership({
  organizationId,
  candidates,
}: {
  organizationId: string;
  candidates: OrganizationMember[];
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(transferOwnershipAction, INITIAL);

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-foreground-muted">{t('transfer.noCandidates')}</p>
        <p className="text-sm text-foreground-muted">{t('transfer.noCandidatesHint')}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded border border-border px-3 py-1.5 text-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground"
      >
        {t('transfer.open')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <p className="text-sm text-warning">{t('transfer.warning')}</p>

      <div className="flex flex-wrap gap-2">
        <select
          name="membershipId"
          required
          aria-label={t('transfer.chooseLabel')}
          className="min-w-48 flex-1 rounded border border-border bg-background px-3 py-2"
        >
          {candidates.map((candidate) => (
            <option key={candidate.membershipId} value={candidate.membershipId}>
              {candidate.shortName || candidate.email || candidate.membershipId}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending}
          className="rounded border border-danger/50 px-4 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
        >
          {pending ? t('common.working') : t('transfer.confirm')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-border px-4 py-2 text-sm text-foreground-muted hover:bg-surface-muted"
        >
          {t('common.cancel')}
        </button>
      </div>

      <p className="text-sm text-foreground-muted">{t('transfer.keepsAdmin')}</p>

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">
          {t(state.errorKey)}
          {state.detail !== undefined && (
            <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
          )}
        </p>
      )}
    </form>
  );
}
