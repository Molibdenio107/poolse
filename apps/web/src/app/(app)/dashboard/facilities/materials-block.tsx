'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import type { PoolMaterial } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../actions';
import {
  addMaterialAction,
  archiveMaterialAction,
  updateMaterialAction,
} from './facilities.actions';

const INITIAL: FormState = { ok: false };

/**
 * What is in the pool room — round 4.
 *
 * "Set how many items there are — buoys, floats — a free text input, and only
 * then set it up on a list." That shape is the whole design and it is worth
 * saying why it was not improved upon: the obvious alternative is a dropdown of
 * approved equipment types, and it fails on the first club that keeps arcos.
 * Every pool calls this kit something slightly different, so the name is what
 * the operator types and the list is what they have typed.
 *
 * **A count, not a stock ledger.** One row per kind of thing, edited in place
 * after a stock check. Movements, reservations and minimum levels were all
 * considered and left out: a ledger nobody posts to drifts from the shelf within
 * a month, and then it is wrong with more decimal places than the count was.
 *
 * The row is a form of its own rather than a modal. Correcting a number is the
 * operation this block exists for — it should cost one click and one keystroke,
 * not a dialog.
 */
export function MaterialsBlock({
  organizationId,
  poolId,
  materials,
  canManage,
}: {
  organizationId: string;
  poolId: string;
  materials: PoolMaterial[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('facilities.materialsHint')}</p>

      {materials.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('facilities.noMaterials')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {materials.map((material) => (
            <li key={material.id} className="py-3 first:pt-0 last:pb-0">
              <MaterialRow
                organizationId={organizationId}
                poolId={poolId}
                material={material}
                canManage={canManage}
              />
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <AddMaterialForm organizationId={organizationId} poolId={poolId} />

          {/*
            The importer is present, styled and visibly inert — the same
            treatment the photo controls get, and for the same reason: a button
            that opened a file picker and then lost the spreadsheet would be
            worse than one that says it is not ready.

            When it lands it goes on the staged pipeline the backoffice already
            uses (upload → parse → map → validate → commit), not a second one-off
            importer. Real inventory spreadsheets have headers that match nobody
            else's, which is exactly what the mapping step is for.
          */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <button
              type="button"
              disabled
              title={t('facilities.materialsImportSoon')}
              className="cursor-not-allowed rounded border border-border px-3 py-1.5 text-sm text-foreground-muted opacity-60"
            >
              {t('facilities.materialsImport')}
            </button>
            <span className="text-sm text-foreground-muted">
              {t('facilities.materialsImportSoon')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Failure({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;

  return (
    <p className="text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

/**
 * One item, editable where it sits.
 *
 * Read-only until somebody asks to change it, because this list is read far more
 * often than it is corrected and a screen of live inputs reads as a form to fill
 * in rather than as a list of what is in the cupboard.
 */
function MaterialRow({
  organizationId,
  poolId,
  material,
  canManage,
}: {
  organizationId: string;
  poolId: string;
  material: PoolMaterial;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateMaterialAction, INITIAL);
  const [archiveState, archive, archiving] = useActionState(archiveMaterialAction, INITIAL);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{material.name}</span>
          {material.notes !== null && material.notes !== '' && (
            <span className="text-sm text-foreground-muted">{material.notes}</span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/*
            The number reads as the fact it is. `tabular-nums` so a column of
            counts lines up rather than dancing by a pixel per digit.
          */}
          <span className="tabular-nums">
            {material.quantity}
            {material.unit !== null && material.unit !== '' && (
              <span className="ml-1 text-sm text-foreground-muted">{material.unit}</span>
            )}
          </span>

          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('facilities.materialEdit')}
              </button>

              <form action={archive}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="poolId" value={poolId} />
                <input type="hidden" name="materialId" value={material.id} />
                <button
                  type="submit"
                  disabled={archiving}
                  aria-label={t('facilities.materialRemoveLabel', { name: material.name })}
                  className="rounded text-foreground-muted hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Trash2 className="size-4" />
                </button>
              </form>
            </>
          )}
        </div>

        <Failure state={archiveState} />
      </div>
    );
  }

  return (
    <form
      action={action}
      onSubmit={() => setEditing(false)}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="poolId" value={poolId} />
      <input type="hidden" name="materialId" value={material.id} />

      <Fields material={material} />

      <button
        type="submit"
        disabled={pending}
        className="h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="h-control rounded border border-border px-4 text-sm"
      >
        {t('common.cancel')}
      </button>

      <Failure state={state} />
    </form>
  );
}

/**
 * Add one kind of item.
 *
 * Uncontrolled on purpose, and the exception proves the rule in `field.tsx`:
 * that rule exists because a form React resets on a returned error wipes what
 * somebody was correcting. Here the reset is what is wanted — the form's whole
 * job is to be typed into repeatedly, and after "Flutuadores, 24" is added the
 * next thing anybody does is type a different item. On an error the fields do
 * hold, because a failed action returns state and React only resets on success.
 */
function AddMaterialForm({
  organizationId,
  poolId,
}: {
  organizationId: string;
  poolId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(addMaterialAction, INITIAL);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="poolId" value={poolId} />

      <Fields />

      <button
        type="submit"
        disabled={pending}
        className="h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60"
      >
        {pending ? t('common.working') : t('facilities.materialAdd')}
      </button>

      <Failure state={state} />
    </form>
  );
}

/** The same four fields, whether adding or correcting. */
function Fields({ material }: { material?: PoolMaterial }): React.ReactElement {
  const t = useTranslations();
  const suffix = material?.id ?? 'new';

  return (
    <>
      {/*
        Fixed widths only once there is room for them. Below `sm` each field
        takes the row — four side-by-side boxes on a 320px screen is four boxes
        too narrow to type a word into, and `flex-wrap` alone would still let the
        widest of them push the page sideways.
      */}
      <div className={cn(FIELD_COLUMN, 'sm:w-56')}>
        <label htmlFor={`material-name-${suffix}`} className={FIELD_LABEL}>
          {t('facilities.materialName')}
        </label>
        <input
          id={`material-name-${suffix}`}
          name="name"
          required
          maxLength={120}
          defaultValue={material?.name ?? ''}
          placeholder={t('facilities.materialNamePlaceholder')}
          className={CONTROL_LINE}
        />
      </div>

      <div className={cn(FIELD_COLUMN, 'sm:w-24')}>
        <label htmlFor={`material-quantity-${suffix}`} className={FIELD_LABEL}>
          {t('facilities.materialQuantity')}
        </label>
        <input
          id={`material-quantity-${suffix}`}
          name="quantity"
          type="number"
          min={0}
          step={1}
          defaultValue={material?.quantity ?? 0}
          className={CONTROL_LINE}
        />
      </div>

      <div className={cn(FIELD_COLUMN, 'sm:w-28')}>
        <label htmlFor={`material-unit-${suffix}`} className={FIELD_LABEL}>
          {t('facilities.materialUnit')}
        </label>
        <input
          id={`material-unit-${suffix}`}
          name="unit"
          maxLength={40}
          defaultValue={material?.unit ?? ''}
          placeholder={t('facilities.materialUnitPlaceholder')}
          className={CONTROL_LINE}
        />
      </div>

      <div className={cn(FIELD_COLUMN, 'sm:w-64')}>
        <label htmlFor={`material-notes-${suffix}`} className={FIELD_LABEL}>
          {t('facilities.materialNotes')}
        </label>
        <input
          id={`material-notes-${suffix}`}
          name="notes"
          maxLength={500}
          defaultValue={material?.notes ?? ''}
          className={CONTROL_LINE}
        />
      </div>
    </>
  );
}
