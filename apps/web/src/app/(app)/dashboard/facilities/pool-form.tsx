'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import type { FormState } from '../actions';
import { createPoolAction, updatePoolAction } from './facilities.actions';

const INITIAL: FormState = { ok: false };

export interface PoolFormValues {
  id?: string;
  name?: string;
  kind?: 'indoor' | 'outdoor';
  volumeLitres?: number | null;
  laneCount?: number | null;
  lengthM?: number | null;
  widthM?: number | null;
  maxDepthM?: number | null;
}

/**
 * One form for creating and editing a pool, on a page of its own.
 *
 * It used to be a row of inputs squeezed into the facilities list — seven fields
 * wrapping across a card, each one labelled only by its placeholder, which
 * vanishes the moment you type. A pool has enough attributes to deserve a page,
 * and putting it on one buys real labels, room to group related fields, and
 * somewhere for the gallery to live beside it.
 *
 * Creating redirects to the pool's own page rather than back to the list. That is
 * the point of the restructure: you fill in the details and land exactly where
 * the photographs go.
 *
 * The facility is fixed and not shown as a field. Moving a pool between sites
 * would orphan every class group scheduled in it — that is a data migration, not
 * an edit.
 */
export function PoolForm({
  organizationId,
  facilityId,
  pool,
  mode,
}: {
  organizationId: string;
  facilityId: string;
  pool?: PoolFormValues;
  mode: 'create' | 'edit';
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(
    mode === 'create' ? createPoolAction : updatePoolAction,
    INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      {pool?.id !== undefined && <input type="hidden" name="poolId" value={pool.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={`${FIELD_COLUMN} sm:col-span-2`}>
          <label htmlFor="pool-name" className={FIELD_LABEL}>
            {t('facilities.poolNameLabel')}
          </label>
          <input
            id="pool-name"
            name="name"
            required
            maxLength={120}
            defaultValue={pool?.name ?? ''}
            placeholder={t('facilities.poolNamePlaceholder')}
            className={CONTROL_LINE}
          />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="pool-kind" className={FIELD_LABEL}>
            {t('facilities.kindLabel')}
          </label>
          <select
            id="pool-kind"
            name="kind"
            defaultValue={pool?.kind ?? 'indoor'}
            className={CONTROL_LINE}
          >
            <option value="indoor">{t('facilities.kind.indoor')}</option>
            <option value="outdoor">{t('facilities.kind.outdoor')}</option>
          </select>
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="pool-lanes" className={FIELD_LABEL}>
            {t('facilities.lanesLabel')}
          </label>
          <input
            id="pool-lanes"
            name="laneCount"
            type="number"
            min={1}
            defaultValue={pool?.laneCount ?? ''}
            className={CONTROL_LINE}
          />
        </div>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm text-foreground-muted">
          {t('facilities.measurements')}
        </legend>

        <div className={FIELD_COLUMN}>
          <label htmlFor="pool-length" className={FIELD_LABEL}>
            {t('facilities.lengthLabel')}
          </label>
          {/*
            step 0.01, never 1: a 12.5 m pool is ordinary, and a control that
            refuses the half metre produces wrong data confidently.
          */}
          <input
            id="pool-length"
            name="lengthM"
            type="number"
            min={0.01}
            step={0.01}
            defaultValue={pool?.lengthM ?? ''}
            className={CONTROL_LINE}
          />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="pool-width" className={FIELD_LABEL}>
            {t('facilities.widthLabel')}
          </label>
          <input
            id="pool-width"
            name="widthM"
            type="number"
            min={0.01}
            step={0.01}
            defaultValue={pool?.widthM ?? ''}
            className={CONTROL_LINE}
          />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="pool-depth" className={FIELD_LABEL}>
            {t('facilities.depthLabel')}
          </label>
          <input
            id="pool-depth"
            name="maxDepthM"
            type="number"
            min={0.01}
            step={0.01}
            defaultValue={pool?.maxDepthM ?? ''}
            className={CONTROL_LINE}
          />
        </div>
      </fieldset>

      <div className={`${FIELD_COLUMN} sm:max-w-64`}>
        <label htmlFor="pool-volume" className={FIELD_LABEL}>
          {t('facilities.volumeLabel')}
        </label>
        <input
          id="pool-volume"
          name="volumeLitres"
          type="number"
          min={1}
          defaultValue={pool?.volumeLitres ?? ''}
          className={CONTROL_LINE}
        />
        <p className="text-sm text-foreground-muted">{t('facilities.optionalHint')}</p>
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending
            ? t('common.working')
            : mode === 'create'
              ? t('facilities.addPool')
              : t('common.save')}
        </button>
      </div>

      {state.ok && mode === 'edit' && (
        <p className="text-sm text-success">{t('facilities.poolSaved')}</p>
      )}
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
