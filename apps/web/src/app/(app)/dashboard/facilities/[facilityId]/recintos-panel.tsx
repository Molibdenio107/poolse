'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PoolseSport } from '@poolse/rules';
import { Archive } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { ARCHIVE_TRIGGER, ARCHIVE_ICON } from '@/lib/archive-trigger';
import { SelectField, TextField, useSuccessKey } from '@/components/ui/field';
import type { PlayingArea } from '@/lib/api';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { addRecintoAction, archiveRecintoAction } from './recintos.actions';

const INITIAL: FormState = { ok: false };
const BUTTON =
  'inline-flex h-control items-center justify-center rounded-sm px-4 text-control hover:bg-surface-muted bg-surface shadow-card';

/**
 * Recintos — the courts and pitches of a site (POOLSE-125's first piece, Rui,
 * 29-10-2026). Shown only when the club has a sport besides swimming switched on
 * in /admin; a pool is still added and archived under Piscinas. One list per
 * sport, an add form for the sports that are on, and archive behind a question.
 *
 * Adding and archiving are the office's (POOLSE-152): both endpoints answer
 * owner and admin only, so for anybody else the panel is the list and nothing
 * more. `canManage` is the site read's own flag; the API refusal is the control.
 */
export function RecintosPanel({
  facilityId,
  areas,
  sports,
  canManage,
}: {
  facilityId: string;
  /** This site's live recintos of sports other than the pool. */
  areas: PlayingArea[];
  /** The club's switched-on sports, pool excluded. */
  sports: PoolseSport[];
  /** Owner or admin — `FacilityDetail.canManage`. */
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const bySport = sports.map((sport) => ({ sport, areas: areas.filter((area) => area.sportId === sport) }));
  // A recinto of a sport switched off since keeps its place in the list.
  const orphans = areas.filter((area) => !sports.includes(area.sportId as PoolseSport));

  return (
    <section className="flex flex-col gap-5 rounded bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">{t('recintos.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('recintos.hint')}</p>
      </div>

      {bySport.map(({ sport, areas: mine }) => (
        <div key={sport} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t(`sport.name.${sport}`)}</h3>
          {mine.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('recintos.none')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded border border-border">
              {mine.map((area) => (
                <Row key={area.id} facilityId={facilityId} area={area} showSport={false} canManage={canManage} />
              ))}
            </ul>
          )}
        </div>
      ))}

      {orphans.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded border border-border">
          {orphans.map((area) => (
            <Row key={area.id} facilityId={facilityId} area={area} showSport canManage={canManage} />
          ))}
        </ul>
      )}

      {canManage && sports.length > 0 && <AddForm facilityId={facilityId} sports={sports} />}
    </section>
  );
}

function Row({
  facilityId,
  area,
  showSport,
  canManage,
}: {
  facilityId: string;
  area: PlayingArea;
  /** Under its sport's heading the sport goes without saying. */
  showSport: boolean;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [asking, setAsking] = useState(false);
  const [state, dispatch, pending] = useSavedAction(archiveRecintoAction, INITIAL);
  useEffect(() => {
    if (state.ok) setAsking(false);
  }, [state]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <span className="flex items-baseline gap-2">
        <span className="font-medium">{area.name}</span>
        {showSport && <span className="text-sm text-foreground-muted">{t(`sport.name.${area.sportId}`)}</span>}
      </span>
      {canManage && (
        <>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className={ARCHIVE_TRIGGER}
          >
            <Archive aria-hidden className={ARCHIVE_ICON} />
            {t('recintos.archive')}
          </button>
          <Dialog
            open={asking}
            onClose={() => setAsking(false)}
            title={t('recintos.archiveTitle', { name: area.name })}
            closeLabel={t('common.close')}
          >
            <form action={dispatch} className="flex flex-col gap-4">
              <input type="hidden" name="facilityId" value={facilityId} />
              <input type="hidden" name="areaId" value={area.id} />
              <p className="text-sm">{t('recintos.archiveConfirm')}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAsking(false)} className={BUTTON}>
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex h-control items-center justify-center gap-2 rounded-sm border border-danger/50 px-4 text-control text-danger hover:bg-danger/10 disabled:opacity-60"
                >
                  {t('recintos.archive')}
                </button>
              </div>
            </form>
          </Dialog>
        </>
      )}
    </li>
  );
}

function AddForm({ facilityId, sports }: { facilityId: string; sports: PoolseSport[] }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(addRecintoAction, INITIAL);
  const key = useSuccessKey(state);
  const error = (field: string): string | undefined => {
    const k = state.fields?.[field];
    return k === undefined ? undefined : t(k);
  };

  return (
    <form key={key} action={dispatch} className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium">{t('recintos.add')}</h3>
      <input type="hidden" name="facilityId" value={facilityId} />
      {/*
        The student record's grid (POOLSE-152): two columns from `sm`, labels
        above, Nome first and full width. The button sits under the fields
        rather than on their row, where Nome's hint used to push its box out of
        line with the select beside it.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          name="name"
          label={t('recintos.name')}
          hint={t('recintos.nameHint')}
          maxLength={120}
          required
          className="max-w-none sm:col-span-2"
          error={error('name')}
        />
        <SelectField
          name="sportId"
          label={t('recintos.sport')}
          initial={sports[0] ?? ''}
          options={sports.map((sport) => ({ value: sport, label: t(`sport.name.${sport}`) }))}
          className="max-w-none"
          error={error('sportId')}
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control text-primary-foreground disabled:opacity-60 font-semibold"
        >
          {t('recintos.add')}
        </button>
      </div>
    </form>
  );
}
