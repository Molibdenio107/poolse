import { getTranslations, getLocale } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import type { Occupancy, TimeBand } from '@/lib/api';
import { OccupancyBars } from './occupancy-bars';

/**
 * The season, in figures — POOLSE-52, criterion 6.
 *
 * **This component performs no arithmetic.** Every number arrives computed by
 * Postgres; all that happens here is formatting for the locale. That is
 * criterion 8, and it is not fussiness: two implementations of "lane-hours" is
 * two answers to one question, and the one on screen would be the one nobody
 * could reproduce when a manager queried it.
 *
 * A server component, because it renders what it is given and holds nothing.
 *
 * **It lives on the dashboard now, not on the facility page.** Rui's third
 * report: this is one of the core things a dashboard is for, and a manager
 * opening Poolse should see how much of the water is sold before they see
 * anything else. It moved wholesale rather than being copied — two of these
 * would be two answers to one question the day somebody edited one.
 *
 * **Lane-hours, not classes.** It is the unit the club actually sells: a booking
 * over three lanes for 45 minutes is 2.25 lane-hours, and "37% occupancy" in
 * those terms is something a manager can act on in a way that "eleven classes"
 * is not.
 *
 * **No money.** Contracted partnership value comes down the same endpoint for
 * the dashboards module and is deliberately rendered nowhere here — criterion 9,
 * and POOLSE-47's decision that partnership billing is its own flow.
 */

const BANDS: readonly TimeBand[] = ['manha', 'tarde', 'noite'];

export async function OccupancyPanel({
  occupancy,
}: {
  occupancy: Occupancy;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  /** A decimal string, in the reader's locale. Formatting, never calculation. */
  const hours = (value: string): string =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number(value));

  const percent = (value: number | null): string =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value) + '%';

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('occupancy.title')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">
          {t('occupancy.hint', { season: occupancy.seasonName })}
        </p>
      </div>

      {/* The three headline figures. */}
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure
          label={t('occupancy.sold')}
          value={t('occupancy.laneHours', { hours: hours(occupancy.total.soldLaneHours) })}
          note={t('occupancy.ofAvailable', {
            hours: hours(occupancy.total.availableLaneHours),
          })}
        />
        <Figure
          label={t('occupancy.utilisation')}
          value={percent(occupancy.laneHourOccupancy)}
          note={
            occupancy.laneHourOccupancy === null ? t('occupancy.noGrid') : t('occupancy.ofWater')
          }
        />
        <Figure
          label={t('occupancy.fullness')}
          value={percent(occupancy.seatOccupancy)}
          note={
            occupancy.seatOccupancy === null ? t('occupancy.noCapacity') : t('occupancy.ofPlaces')
          }
        />
      </dl>

      {/*
        The asterisk, said out loud — criterion 3.

        `lane.default_capacity` is nullable by design, so the fullness figure can
        only cover the lanes somebody has sized. A percentage with a hidden
        exclusion is worse than one that names it.
      */}
      {occupancy.lanesWithoutCapacity > 0 && (
        <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {t('occupancy.uncovered', { count: occupancy.lanesWithoutCapacity })}
          </span>
        </p>
      )}

      {/* Turmas against parcerias — the split the ticket exists to expose. */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">{t('occupancy.split')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="py-2 pr-4 font-medium">{t('occupancy.subject')}</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('occupancy.laneHoursShort')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('occupancy.swimmers')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-2 pr-4">{t('occupancy.turmas')}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {hours(occupancy.total.turmaLaneHours)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {occupancy.total.turmaHeadcount}
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4">{t('occupancy.parcerias')}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {hours(occupancy.total.parceriaLaneHours)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {occupancy.total.parceriaHeadcount}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* By time band. Three fixed bands — nobody has asked to move them. */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">{t('occupancy.byBand')}</h3>
        <ul className="grid gap-2 sm:grid-cols-3">
          {BANDS.map((band) => {
            const slice = occupancy.byBand.find((entry) => entry.band === band);
            return (
              <li key={band} className="rounded border border-border p-3">
                <p className="text-sm font-medium">{t(`occupancy.band.${band}`)}</p>
                <p className="mt-0.5 text-sm text-foreground-muted">
                  {t('occupancy.laneHours', {
                    hours: hours(slice?.soldLaneHours ?? '0'),
                  })}
                </p>
                {/*
                  The split again, per band — this is where the club's actual
                  shape shows: mornings are schools, evenings are families.
                */}
                <p className="text-sm text-foreground-muted">
                  {t('occupancy.bandSplit', {
                    turmas: hours(slice?.turmaLaneHours ?? '0'),
                    parcerias: hours(slice?.parceriaLaneHours ?? '0'),
                  })}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {/*
        By day, as a chart — Rui's third report asked for a graphic here.
        
        It replaces the plain progress bar this block used to hold rather than
        joining it: two pictures of one dataset is noise, and the old one could
        not show the split between the club's own turmas and the water sold to
        organisations, which is the second question every one of these figures
        raises. See `occupancy-bars.tsx` for why the colours are what they are.
      */}
      <div className="border-t border-border pt-4">
        <OccupancyBars occupancy={occupancy} locale={locale} />
      </div>

    </section>
  );
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}): React.ReactElement {
  return (
    <div className="rounded border border-border p-3">
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</dd>
      <p className="mt-0.5 text-sm text-foreground-muted">{note}</p>
    </div>
  );
}
