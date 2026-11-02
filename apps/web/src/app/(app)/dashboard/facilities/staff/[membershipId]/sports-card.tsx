'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PoolseSport } from '@poolse/rules';
import { SportChip } from '@/components/sport-chip';
import { SportIcon, sportNameKey } from '@/components/sport-icon';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../actions';
import { saveStaffSportsAction } from './sports.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Desportos* — POOLSE-145. The sports an instructor belongs to, set explicitly
 * by the owner or an admin (Rui, 01-11-2026). An instructor then reads only
 * these sports' students; owner and admin read every sport whatever this says.
 * Shown only in a club with more than one sport, and only for an instructor.
 */
export function SportsCard({
  membershipId,
  sports,
  clubSports,
  canManage,
}: {
  membershipId: string;
  sports: readonly PoolseSport[];
  clubSports: readonly PoolseSport[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(saveStaffSportsAction, INITIAL);
  const [chosen, setChosen] = useState<ReadonlySet<PoolseSport>>(() => new Set(sports));
  const error = state.fields?.['sports'];

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <h2 className="font-medium">{t('staff.sports.title')}</h2>
      <p className="text-sm text-foreground-muted">{t('staff.sports.intro')}</p>
      {canManage ? (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="membershipId" value={membershipId} />
          <fieldset className="flex flex-wrap gap-2" aria-describedby={error === undefined ? undefined : 'staff-sports-error'}>
            <legend className="sr-only">{t('staff.sports.title')}</legend>
            {clubSports.map((sport) => (
              <label
                key={sport}
                className="inline-flex h-control cursor-pointer items-center gap-2 rounded-sm bg-surface px-3 text-control shadow-card has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
              >
                <input
                  type="checkbox"
                  name="sport"
                  value={sport}
                  checked={chosen.has(sport)}
                  onChange={(event) =>
                    setChosen((now) => {
                      const next = new Set(now);
                      if (event.target.checked) next.add(sport);
                      else next.delete(sport);
                      return next;
                    })
                  }
                  className="size-4"
                />
                <SportIcon sport={sport} className="size-4" />
                {t(sportNameKey(sport))}
              </label>
            ))}
          </fieldset>
          {error !== undefined && (
            <p id="staff-sports-error" className="text-sm text-danger">
              {t(error)}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={pending || chosen.size === 0}
              className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
            >
              {t('staff.sports.save')}
            </button>
          </div>
          {chosen.size === 0 && <p className="text-sm text-foreground-muted">{t('staff.sports.errors.required')}</p>}
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sports.map((sport) => (
            <SportChip key={sport} sport={sport} />
          ))}
        </div>
      )}
    </section>
  );
}
