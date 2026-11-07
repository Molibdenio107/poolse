'use client';

import { IdCard, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ID_DOCUMENT_TYPES } from '@poolse/rules';
import { SelectField, TextField } from '@/components/ui/field';
import { formatDate } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import type { StaffIdDocumentType, StaffIdentity } from '@/lib/api';
import type { FormState } from '../../../actions';
import { saveIdentityAction } from './identity.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Identificação* — POOLSE-100. Rendered only when the API answered, which is
 * the owner, an admin or the person themself; anybody else never gets the card.
 *
 * The date of birth is editable here only for somebody without a login: with
 * one it is theirs, set in *O meu perfil*, and the card says so. The ID
 * document's purpose and how long it is kept are said at the field, not in a
 * policy somewhere else.
 */
export function IdentityCard({
  membershipId,
  identity,
  own,
  canEdit = true,
  ownerCorrects = false,
  proposal = null,
}: {
  membershipId: string;
  identity: StaffIdentity;
  /** The reader is the person on the record. */
  own: boolean;
  /** An Admin reads this and the Owner writes it (Rui, 07-11-2026). */
  canEdit?: boolean;
  /** The Owner on somebody else's record, who may correct a login's date of birth. */
  ownerCorrects?: boolean;
  /** What the reader proposed from the photograph (POOLSE-149), for a person to confirm. */
  proposal?: { type: StaffIdDocumentType | null; number: string | null } | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(saveIdentityAction, INITIAL);
  const error = (field: string): { error?: string } =>
    state.fields?.[field] === undefined ? {} : { error: t(state.fields[field]) };

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-1.5 font-medium">
        <IdCard className="size-4" aria-hidden />
        {t('staffIdentity.title')}
      </h2>
      <p className="flex items-start gap-1.5 text-sm text-foreground-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('staffIdentity.visibility')}
      </p>

      {proposal !== null && (
        <p className="rounded-sm bg-surface-muted p-3 text-sm">{t('staffIdentity.photo.proposed')}</p>
      )}

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="membershipId" value={membershipId} />
        <fieldset disabled={!canEdit} className="contents">

        {identity.birthDateSource === 'record' || ownerCorrects ? (
          <TextField
            name="birthDate"
            type="date"
            label={t('staffIdentity.birthDate')}
            initial={identity.birthDate ?? ''}
            {...(identity.birthDateSource === 'login' ? { hint: t('staffIdentity.birthDateOwnerCorrects') } : {})}
            {...error('birthDate')}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-foreground-muted">{t('staffIdentity.birthDate')}</span>
            <span>{identity.birthDate === null ? '—' : formatDate(identity.birthDate)}</span>
            <span className="text-sm text-foreground-muted">
              {own ? t('staffIdentity.birthDateOwnProfile') : t('staffIdentity.birthDateTheirs')}
            </span>
          </div>
        )}

        <SelectField
          name="idDocumentType"
          label={t('staffIdentity.documentType')}
          initial={proposal?.type ?? identity.idDocument?.type ?? ''}
          options={[
            { value: '', label: t('staffIdentity.noDocument') },
            ...ID_DOCUMENT_TYPES.map((type) => ({ value: type, label: t(`staffIdentity.type.${type}`) })),
          ]}
          {...error('idDocumentType')}
        />
        <TextField
          name="idDocumentNumber"
          label={t('staffIdentity.documentNumber')}
          initial={proposal?.number ?? identity.idDocument?.number ?? ''}
          hint={t('staffIdentity.purpose', { months: identity.retentionMonths })}
          {...error('idDocumentNumber')}
        />

        <div>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
          >
            {t('staffIdentity.save')}
          </button>
        </div>
        </fieldset>
        {!canEdit && <p className="text-sm text-foreground-muted">{t('staff.ownerEdits')}</p>}
      </form>
    </section>
  );
}
