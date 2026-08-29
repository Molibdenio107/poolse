'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import type { FormState } from '../actions';
import {
  archiveFacilityAction,
  archivePoolAction,
  createFacilityAction,
  createPoolAction,
} from './facilities.actions';

const INITIAL: FormState = { ok: false };

function Error({ state }: { state: FormState }): React.ReactElement | null {
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
 * Three fields, one of them optional and one with a sensible default.
 *
 * The timezone is here rather than buried in a settings screen because it is the
 * field with the longest-lived consequence: class times are stored UTC and shown
 * in the facility's timezone, so a site in the Azores set to Lisbon shows every
 * lesson an hour wrong for as long as nobody notices.
 */
export function CreateFacilityForm({
  organizationId,
  timezones,
}: {
  organizationId: string;
  timezones: string[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createFacilityAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className={FIELD_COLUMN}>
        <label htmlFor="facility-name" className={FIELD_LABEL}>
          {t('facilities.nameLabel')}
        </label>
        <input
          id="facility-name"
          name="name"
          required
          maxLength={120}
          placeholder={t('facilities.namePlaceholder')}
          className={CONTROL_LINE}
        />
      </div>

      <div className={FIELD_COLUMN}>
        <label htmlFor="facility-address" className={FIELD_LABEL}>
          {t('facilities.addressLabel')}
        </label>
        <input id="facility-address" name="address" maxLength={500} className={CONTROL_LINE} />
      </div>

      <div className={FIELD_COLUMN}>
        <label htmlFor="facility-timezone" className={FIELD_LABEL}>
          {t('facilities.timezoneLabel')}
        </label>
        <select id="facility-timezone" name="timezone" defaultValue={timezones[0]} className={CONTROL_LINE}>
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="text-sm text-foreground-muted">{t('facilities.timezoneHint')}</p>
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('facilities.create')}
        </button>
      </div>

      <Error state={state} />
    </form>
  );
}

/**
 * Archiving, not deleting — the row stays and the name is freed.
 *
 * Two steps rather than one, and not out of politeness. Archiving a facility
 * archives every pool inside it, which the single button never said: an operator
 * tidying up one site could retire six tanks and only find out later. The
 * confirmation names the consequence rather than asking a generic "are you
 * sure?", because the generic question teaches people to click yes without
 * reading it.
 */
export function ArchiveButton({
  organizationId,
  facilityId,
  poolId,
  poolCount = 0,
}: {
  organizationId: string;
  facilityId?: string;
  poolId?: string;
  /** Pools that would go with this facility. Ignored when archiving one pool. */
  poolCount?: number;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const isFacility = poolId === undefined;
  const [state, action, pending] = useActionState(
    isFacility ? archiveFacilityAction : archivePoolAction,
    INITIAL,
  );

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('facilities.archive')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      {facilityId !== undefined && <input type="hidden" name="facilityId" value={facilityId} />}
      {poolId !== undefined && <input type="hidden" name="poolId" value={poolId} />}

      <span className="text-sm text-foreground-muted">
        {isFacility
          ? poolCount > 0
            ? t('facilities.confirmArchiveSite', { count: poolCount })
            : t('facilities.confirmArchiveEmptySite')
          : t('facilities.confirmArchivePool')}
      </span>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-danger/50 px-2 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
      >
        {pending ? t('common.working') : t('facilities.confirmArchive')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:bg-surface-muted"
      >
        {t('common.cancel')}
      </button>

      {state.errorKey !== undefined && (
        <span className="text-sm text-danger">{t(state.errorKey)}</span>
      )}
    </form>
  );
}
