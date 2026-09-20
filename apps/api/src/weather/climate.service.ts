import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withOrg, withPlatform } from '@poolse/db';
import { climateHistoryEnabled, fetchClimateHistory } from './open-meteo.js';
import { facilityPoint, foldIntoMonths, saveClimate } from './climate.repository.js';

/**
 * Keeps each site's monthly air temperature filled in — roadmap 5.4b.
 *
 * **A scheduled job rather than a fetch on page load**, for the reason the rest
 * of this module states about the forecast: nothing a club looks at should wait
 * on somebody else's API, and a render that hangs for ten seconds is a page that
 * looks broken. The energy screens read whatever is in the table and say plainly
 * when a month is missing.
 *
 * **Off unless a deployment turns it on.** `WEATHER_HISTORY_ENABLED` is the
 * flag, and without it this class does nothing at all — no call, no row, no
 * difference. That is the state of the free pilot and of every dev machine, and
 * it is the standing rule for anything metered or licensed.
 *
 * **Daily, not hourly.** The data is monthly; the only row that changes between
 * one day and the next is the current month, which gets one day longer. A club
 * that has just placed its site on the map waits until tomorrow for its history,
 * which is the right trade against calling an archive every hour for figures
 * that were settled in 1974.
 *
 * **One request per site.** Twenty-five months of daily means is a single call;
 * fetching month by month would be twenty-five, and the endpoint is somebody
 * else's. The whole window is refetched rather than only the gaps — the archive
 * revises recent days, and `saveClimate` upserts, so a correction lands and a
 * partial current month is completed as it fills in.
 */
@Injectable()
export class ClimateService {
  private readonly log = new Logger(ClimateService.name);

  /**
   * Two years and a month.
   *
   * The charts compare twelve months against the twelve before them, so the
   * window has to hold both — plus one, because the month a comparison reaches
   * back to is itself inside the earlier year and a fencepost here would leave
   * the oldest comparable month without its temperature.
   */
  private static readonly MONTHS = 25;

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      /*
       * Swallowed, like the trial clock's. An unhandled rejection from a cron
       * takes the API process down with it, and an archive being slow at 04:00
       * must not close the app for every club. Tomorrow tries again, because
       * the job is driven by what is in the table rather than by a cursor.
       */
      this.log.error('The climate filler failed today', error as Error);
    }
  }

  /**
   * One pass, over every located site or over one tenant's.
   *
   * `organizationId` narrows it for the same reason the trial clock's does: the
   * job is global by design, and an integration suite runs its files
   * concurrently against one database, so an unscoped pass would reach into
   * another test's scratch tenant.
   */
  async run(organizationId?: string): Promise<{ sites: number; months: number }> {
    if (!climateHistoryEnabled()) return { sites: 0, months: 0 };

    /*
     * **Two logins, and the split is the point.** The list of tenants is
     * cross-tenant by definition, so it comes from `poolse_platform`, which is
     * already granted `SELECT` on `organization` for the trial clock. The
     * *facilities* are then read inside each tenant's own policy on the ordinary
     * application login.
     *
     * The alternative — putting `facility` on the platform grant — would have
     * been one line and is exactly the widening CLAUDE.md says to take out loud
     * rather than slip into a feature. Nothing here needs to see two clubs at
     * once, so nothing here is allowed to.
     */
    const tenants = organizationId !== undefined
      ? [organizationId]
      : await withPlatform(async (tx) => {
          const { rows } = await tx.query<{ id: string }>(
            `SELECT id FROM organization
              WHERE archived_at IS NULL AND suspended_at IS NULL
              ORDER BY id`,
          );
          return rows.map((row) => row.id);
        });

    let sites = 0;
    let months = 0;

    for (const tenant of tenants) {
      // A site nobody has placed on the map has no point to ask about. That is
      // ordinary — the location picker is optional — and not an error.
      const located = await withOrg(tenant, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM facility
            WHERE archived_at IS NULL
              AND latitude IS NOT NULL AND longitude IS NOT NULL
            ORDER BY id`,
        );
        return rows.map((row) => row.id);
      });

      for (const facilityId of located) {
        sites += 1;
        months += await this.fillOne(tenant, facilityId);
      }
    }

    return { sites, months };
  }

  /** One site: its window fetched whole and written back. */
  private async fillOne(organizationId: string, facilityId: string): Promise<number> {
    const point = await facilityPoint(organizationId, facilityId);
    // Placed on the map since the query above? Nothing to do, and no error:
    // a site without coordinates is ordinary, and the screens say so.
    if (point === null) return 0;

    const { start, end } = window(ClimateService.MONTHS);
    const days = await fetchClimateHistory(point.latitude, point.longitude, start, end);
    // Null is "unreachable or switched off" — already logged by the fetcher.
    if (days === null || days.length === 0) return 0;

    return saveClimate(organizationId, facilityId, foldIntoMonths(days));
  }
}

/**
 * The first day of the month `months - 1` back, to yesterday.
 *
 * **Yesterday and not today**: the archive is a record of days that have
 * finished, and asking for today returns either nothing or a partial figure
 * that would be written as though it were a whole day's mean.
 */
export function window(months: number): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
