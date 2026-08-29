'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
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
  minDepthM?: number | null;
}

/**
 * The four measurements, and the volume they imply — round 4.
 *
 * **Why these are controlled and the rest of this form was not.** They have to
 * be: the volume is computed from them as they are typed, and an uncontrolled
 * input has no value to compute from until it is submitted. That happens to fix
 * the POOLSE-09 bug these five fields still had — `defaultValue` means React 19
 * wipes them when the action returns a validation error, which is precisely when
 * somebody is being asked to correct one of them.
 *
 * **Average depth.** `length x width x (min + max) / 2`, cubic metres, times a
 * thousand. Exact for a floor that slopes evenly; an estimate for a flat shallow
 * end and a sudden trough. The hint says which it is rather than presenting the
 * figure as a measurement, and the field stays editable — an L-shaped tank has a
 * real volume that no box calculation will produce.
 *
 * **It fills the field, it does not own it.** The suggestion is written in only
 * while the box is empty or still holds the previous suggestion. The moment an
 * operator types their own number, the calculation stops touching it and becomes
 * a line of text underneath — because the figure from the builder's drawings
 * beats arithmetic on four rounded metres, and silently overwriting it would be
 * the worst thing this control could do.
 */
function PoolDimensions({ pool }: { pool?: PoolFormValues | undefined }): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();

  const asText = (value: number | null | undefined): string =>
    value === null || value === undefined ? '' : String(value);

  const [lengthM, setLengthM] = useState(asText(pool?.lengthM));
  const [widthM, setWidthM] = useState(asText(pool?.widthM));
  const [minDepthM, setMinDepthM] = useState(asText(pool?.minDepthM));
  const [maxDepthM, setMaxDepthM] = useState(asText(pool?.maxDepthM));
  const [volume, setVolume] = useState(asText(pool?.volumeLitres));
  // Controlled for the same reason the four measurements are: React 19 clears an
  // uncontrolled field when the action returns a validation error.
  const [laneCount, setLaneCount] = useState(asText(pool?.laneCount));

  // What the calculation last wrote, so an operator's own figure can be told
  // apart from one this control put there.
  const written = useRef<string | null>(null);

  const num = (value: string): number | null => {
    const parsed = Number(value.trim().replace(',', '.'));
    return value.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed;
  };

  const l = num(lengthM);
  const w = num(widthM);
  const lo = num(minDepthM);
  const hi = num(maxDepthM);

  // All four, or nothing. Three of them and an assumed fourth would be a number
  // that looks computed and is invented.
  const suggested =
    l !== null && w !== null && lo !== null && hi !== null && hi >= lo
      ? Math.round(l * w * ((lo + hi) / 2) * 1000 * 100) / 100
      : null;

  useEffect(() => {
    if (suggested === null) return;
    const next = String(suggested);
    setVolume((current) =>
      current.trim() === '' || current === written.current ? next : current,
    );
    written.current = next;
  }, [suggested]);

  const mine = suggested !== null && volume !== String(suggested) && volume.trim() !== '';

  // Whatever is in the box right now — the operator's own figure or the offered
  // one — so the grouped reading and the m3 always describe what will be saved.
  const entered = num(volume);

  return (
    <>
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-medium">{t('facilities.measurements')}</legend>

        {(
          [
            ['pool-length', 'lengthM', t('facilities.lengthLabel'), lengthM, setLengthM],
            ['pool-width', 'widthM', t('facilities.widthLabel'), widthM, setWidthM],
            ['pool-min-depth', 'minDepthM', t('facilities.minDepthLabel'), minDepthM, setMinDepthM],
            ['pool-depth', 'maxDepthM', t('facilities.depthLabel'), maxDepthM, setMaxDepthM],
          ] as const
        ).map(([id, name, label, value, set]) => (
          <div key={id} className={FIELD_COLUMN}>
            <label htmlFor={id} className={FIELD_LABEL}>
              {label}
            </label>
            {/*
              step 0.01, never 1: a 12.5 m pool is ordinary, and a control that
              refuses the half metre produces wrong data confidently.
            */}
            <input
              id={id}
              name={name}
              type="number"
              min={0.01}
              step={0.01}
              value={value}
              onChange={(event) => set(event.target.value)}
              className={CONTROL_LINE}
            />
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap items-start gap-4">
        <legend className="mb-2 text-sm font-medium">{t('facilities.capacity')}</legend>

        <div className={FIELD_COLUMN + ' sm:w-32'}>
          <label htmlFor="pool-lanes" className={FIELD_LABEL}>
            {t('facilities.lanesLabel')}
          </label>
          <input
            id="pool-lanes"
            name="laneCount"
            type="number"
            min={1}
            value={laneCount}
            onChange={(event) => setLaneCount(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>

      <div className={`${FIELD_COLUMN} sm:max-w-64`}>
        <label htmlFor="pool-volume" className={FIELD_LABEL}>
          {t('facilities.volumeLabel')}
        </label>
        <input
          id="pool-volume"
          name="volumeLitres"
          type="number"
          min={0.01}
          step={0.01}
          value={volume}
          onChange={(event) => setVolume(event.target.value)}
          className={CONTROL_LINE}
        />

        {/*
          Grouped digits and cubic metres, always — round 4.
          `1 000 000 L` is readable and `1000000` is not, and a pool's size is
          quoted in m3 as often as in litres, so both are shown rather than
          leaving the operator to divide by a thousand. `format.number` groups
          per locale, which in pt-PT is the space the ticket asks for; forcing a
          space would have put one in the English build too, where it is wrong.
        */}
        {entered !== null && (
          <p className="text-sm font-medium">
            {format.number(entered, { maximumFractionDigits: 2 })} L
            <span className="text-foreground-muted">
              {' '}
              &middot; {format.number(entered / 1000, { maximumFractionDigits: 2 })} m&sup3;
            </span>
          </p>
        )}

        {suggested === null ? (
          <p className="text-sm text-foreground-muted">{t('facilities.volumeHint')}</p>
        ) : (
          <p className="text-sm text-foreground-muted">
            {t('facilities.volumeComputed', {
              litres: format.number(suggested, { maximumFractionDigits: 2 }),
            })}
          </p>
        )}

        {/*
          Only once the two disagree. A button offering to replace a number with
          the number already in the box is noise.
        */}
        {mine && (
          <button
            type="button"
            onClick={() => {
              setVolume(String(suggested));
              written.current = String(suggested);
            }}
            className="self-start rounded text-sm text-primary underline underline-offset-2"
          >
            {t('facilities.volumeUseComputed')}
          </button>
        )}
      </div>
      </fieldset>
    </>
  );
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
      </div>

      <PoolDimensions pool={pool} />

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
