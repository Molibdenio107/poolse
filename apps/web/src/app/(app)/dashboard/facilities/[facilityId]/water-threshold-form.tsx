'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import { CONTROL_LINE, useSeeded } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../../actions';
import { saveWaterThresholdAction } from './facility.actions';

const INITIAL: FormState = { ok: false };

/**
 * How often a site's water must be analysed — POOLSE-66 slice 2b; worded as a
 * club says it since POOLSE-231 (Rui, 19-11-2026).
 *
 * One box, hours, empty for "not checked". It is what puts a tank on the
 * Painel's *Água por analisar*, and the sentence under it says so in visible
 * text. The field sits inside its own sentence (*Analisar a água pelo menos a
 * cada __ horas*): the words are two keys around it, and the field's accessible
 * name is the whole sentence, never a fragment. Shown to everybody who may see
 * the site; editable by an owner or admin, which the API enforces.
 */
export function WaterThresholdForm({
  facilityId,
  hours,
  canManage,
}: {
  facilityId: string;
  hours: number | null;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(saveWaterThresholdAction, INITIAL);
  const [value, setValue] = useSeeded<string>(hours === null ? '' : String(hours));
  const id = useId();

  if (!canManage) {
    return (
      <p className="text-sm">
        {hours === null
          ? t('facilities.waterThreshold.notSet')
          : t('facilities.waterThreshold.value', { hours })}
      </p>
    );
  }

  const error = state.fields?.['hours'];

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden>{t('facilities.waterThreshold.labelBefore')}</span>
          <input
            id={id}
            name="hours"
            inputMode="numeric"
            maxLength={4}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={t('facilities.waterThreshold.label')}
            aria-describedby={`${id}-hint`}
            aria-invalid={error !== undefined}
            className={cn(CONTROL_LINE, 'w-24 text-center')}
          />
          <span aria-hidden>{t('facilities.waterThreshold.labelAfter')}</span>
        </label>
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {t('facilities.waterThreshold.hint')}
        </p>
        {error !== undefined && (
          <p className="text-sm text-danger" role="alert">
            {t(error)}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center gap-2 self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>
    </form>
  );
}
