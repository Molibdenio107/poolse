'use client';

import { useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, useSeeded } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { OrganizationMember } from '@/lib/api';
import type { FormState } from '../actions';
import { transferOwnershipAction } from '../actions';
import { Reveal } from '@/components/ui/reveal';

const INITIAL: FormState = { ok: false };

/**
 * Handing the organization to somebody else.
 *
 * It sits on "O meu perfil" rather than on Pessoas, where it started. Ownership
 * is something one account holds, not a property of the staff list, and the
 * owner who wants to hand it over is thinking about their own account when they
 * go looking for the control.
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
  const [state, action, pending] = useSavedAction(transferOwnershipAction, INITIAL);
  // Controlled, so a refused transfer keeps the person who was chosen. An
  // uncontrolled select reset to the first candidate, and a second click on
  // Confirm would have handed the club to somebody else.
  const [membershipId, setMembershipId] = useSeeded<string>(
    candidates[0]?.membershipId ?? '',
  );

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
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded border border-border text-foreground-muted hover:bg-surface-muted hover:text-foreground"
      >
        {t('transfer.open')}
      </button>
    );
  }

  return (
    <Reveal open appear>
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <p className="text-sm text-warning">{t('transfer.warning')}</p>

      <div className="flex flex-wrap gap-2">
        <select
          name="membershipId"
          required
          value={membershipId}
          onChange={(event) => setMembershipId(event.target.value)}
          aria-label={t('transfer.chooseLabel')}
          className={cn(CONTROL_LINE, 'min-w-48 flex-1')}
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
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-60"
        >
          {pending ? t('common.working') : t('transfer.confirm')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:bg-surface-muted"
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
    </Reveal>
  );
}
