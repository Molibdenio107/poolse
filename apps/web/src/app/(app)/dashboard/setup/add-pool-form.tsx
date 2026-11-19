'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Button } from '@/components/ui/button';
import { CONTROL_LINE, FIELD_LABEL } from '@/components/ui/field';
import type { FormState } from '../actions';
import { addSetupPoolAction } from '../facilities/facilities.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Adicionar tanque* inside the setup's step 2 — Rui, 19-11-2026: the Owner
 * adds tanks without leaving the setup. Name, length and lanes only; the tank
 * appears in the list above at once, and its *Abrir* takes the rest (photos,
 * volume, depths, capacity) to its own page. The boxes clear after each one, so
 * a club with three tanks types three names in a row.
 */
export function AddPoolForm({
  organizationId,
  facilityId,
}: {
  organizationId: string;
  facilityId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [name, setName] = useState('');
  const [lengthM, setLengthM] = useState('');
  const [laneCount, setLaneCount] = useState('');
  const [state, action, pending] = useSavedAction(addSetupPoolAction, INITIAL);
  const nameRef = useRef<HTMLInputElement>(null);

  // A tank added: empty boxes, and the cursor back on the name for the next one.
  useEffect(() => {
    if (!state.ok) return;
    setName('');
    setLengthM('');
    setLaneCount('');
    nameRef.current?.focus();
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="setup-pool-name" className={FIELD_LABEL}>
            {t('facilities.poolNameLabel')}
          </label>
          <input
            ref={nameRef}
            id="setup-pool-name"
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('facilities.poolNamePlaceholder')}
            className={CONTROL_LINE}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="setup-pool-length" className={FIELD_LABEL}>
            {t('facilities.lengthLabel')}
          </label>
          <input
            id="setup-pool-length"
            name="lengthM"
            type="number"
            min={1}
            step="0.01"
            inputMode="decimal"
            value={lengthM}
            onChange={(event) => setLengthM(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="setup-pool-lanes" className={FIELD_LABEL}>
            {t('facilities.lanesLabel')}
          </label>
          <input
            id="setup-pool-lanes"
            name="laneCount"
            type="number"
            min={1}
            inputMode="numeric"
            value={laneCount}
            onChange={(event) => setLaneCount(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>
      </div>
      <p className="text-sm text-foreground-muted">{t('setup.step.places.poolHint')}</p>
      <Button type="submit" icon={Plus} disabled={pending} className="self-start">
        {t('setup.step.places.addPool')}
      </Button>
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey)}
          {state.detail !== undefined && <span className="ml-2 text-xs text-foreground-muted">{state.detail}</span>}
        </p>
      )}
    </form>
  );
}
