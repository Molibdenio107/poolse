'use client';

import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import { TextField } from '@/components/ui/field';
import type { FormState } from '../../actions';
import { saveWaterThresholdAction } from './facility.actions';

const INITIAL: FormState = { ok: false };

/**
 * How old a site's latest water analysis may be — POOLSE-66 slice 2b.
 *
 * One box, hours, empty for "not measured". Shown to everybody who may see the
 * site, because "a tank here is due after 24 hours" explains the dashboard;
 * editable by an owner or admin, which the API enforces rather than this.
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
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <TextField
        name="hours"
        label={t('facilities.waterThreshold.label')}
        hint={t('facilities.waterThreshold.hint')}
        initial={hours === null ? '' : String(hours)}
        inputMode="numeric"
        maxLength={4}
        error={error === undefined ? undefined : t(error)}
        className="w-48"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>
    </form>
  );
}
