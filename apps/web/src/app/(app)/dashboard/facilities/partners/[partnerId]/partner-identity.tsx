'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { PartnerDetail, PartnerType } from '@/lib/api';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { savePartnerAction } from '../../[facilityId]/partners.actions';

/**
 * Who the partner is — POOLSE-47, criterion 9.
 *
 * Read-only until somebody presses Editar, because this is the block people
 * come here to *read*: the NIF for an invoice, the address for a letter. A form
 * that is always open makes a reference card look like data entry.
 *
 * **`inativa` lives here rather than behind a delete button.** A partnership
 * that lapsed is not a mistake to be undone — it still explains last season's
 * grid, and the status is what takes it out of the pickers while keeping it.
 */

const INITIAL: FormState = { ok: false };

const PARTNER_TYPES: readonly PartnerType[] = [
  'escola',
  'agrupamento',
  'ipss_misericordia',
  'jardim_infancia',
  'clube',
  'camara',
  'empresa',
  'outro',
];

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'h-control rounded border border-border px-4 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function PartnerIdentity({
  partner,
}: {
  partner: PartnerDetail;
}): React.ReactElement {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [state, save, pending] = useSavedAction(savePartnerAction, INITIAL);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('partners.identity')}
        </h2>

        {partner.canManage && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={BUTTON_QUIET}>
            {t('common.edit')}
          </button>
        )}
      </div>

      {editing ? (
        <form action={save} className="flex flex-col gap-4">
          <input type="hidden" name="facilityId" value={partner.facilityId} />
          <input type="hidden" name="partnerId" value={partner.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="name"
              label={t('partners.name')}
              initial={partner.name}
              required
              maxLength={160}
              error={state.fields?.['name'] ? t(state.fields['name']) : undefined}
            />

            <SelectField
              name="type"
              label={t('partners.type')}
              initial={partner.type}
              options={PARTNER_TYPES.map((type) => ({
                value: type,
                label: t(`partners.kind.${type}`),
              }))}
            />

            <TextField
              name="nif"
              label={t('partners.nif')}
              initial={partner.nif ?? ''}
              maxLength={9}
              hint={t('partners.nifHint')}
              error={state.fields?.['nif'] ? t(state.fields['nif']) : undefined}
            />

            <SelectField
              name="status"
              label={t('partners.status')}
              initial={partner.status}
              hint={t('partners.statusHint')}
              options={[
                { value: 'ativa', label: t('partners.state.ativa') },
                { value: 'inativa', label: t('partners.state.inativa') },
              ]}
            />

            <TextField
              name="color"
              label={t('partners.color')}
              type="color"
              initial={partner.color}
              hint={t('partners.colorHint')}
            />

            <TextField
              name="address"
              label={t('partners.address')}
              initial={partner.address ?? ''}
              maxLength={400}
            />
          </div>

          <TextAreaField
            name="notes"
            label={t('partners.notes')}
            initial={partner.notes ?? ''}
            rows={3}
            maxLength={2000}
          />

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">{t(state.errorKey)}</p>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={BUTTON}>
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BUTTON_QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label={t('partners.type')} value={t(`partners.kind.${partner.type}`)} />
          <Fact label={t('partners.nif')} value={partner.nif} />
          <Fact label={t('partners.address')} value={partner.address} />
          <div>
            <dt className="text-sm text-foreground-muted">{t('partners.color')}</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 rounded-sm border border-border"
                style={{ backgroundColor: partner.color }}
              />
              {/*
                The hex is spelled out, so the swatch is never the only way to
                know what was chosen — the same rule the grid cells follow.
              */}
              <span className="font-mono text-sm">{partner.color}</span>
            </dd>
          </div>
          <Fact label={t('partners.status')} value={t(`partners.state.${partner.status}`)} />
          {partner.notes !== null && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-foreground-muted">{t('partners.notes')}</dt>
              <dd className="mt-0.5 whitespace-pre-line">{partner.notes}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

/** One labelled fact, with an em dash where there is nothing recorded. */
function Fact({ label, value }: { label: string; value: string | null }): React.ReactElement {
  return (
    <div>
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd className="mt-0.5">{value ?? '—'}</dd>
    </div>
  );
}
