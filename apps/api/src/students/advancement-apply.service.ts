import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { withPlatform } from '@poolse/db';
import { asSystem } from '../tenant/tenant.context.js';
import { applyDueAgeProposals } from './advancement.repository.js';
import { deliverLevelChangeNotice } from './level-change-delivery.js';

/**
 * Applies age proposals on the season's first day — POOLSE-112 BA 2, for a
 * club that chose *Aplicar automaticamente*.
 *
 * Tenants come from `poolse_platform`; the work happens inside each tenant's
 * own policy as *the system* (`asSystem`), under a per-tenant advisory lock so
 * two Railway instances do not both move a child. Each tenant is its own
 * transaction, and the family's emails leave after it commits. A club in
 * *Propor* is read and left alone by the repository, so the mode is checked in
 * one place.
 *
 * Nightly rather than at publish time, because a season is usually published
 * weeks before it starts and the level must not move until it does; a club
 * that switches to automatic after the season began is caught the next night.
 */
@Injectable()
export class AdvancementApplyService {
  private readonly log = new Logger(AdvancementApplyService.name);

  @Cron('20 4 * * *', { timeZone: 'Europe/Lisbon' })
  async tick(): Promise<void> {
    try {
      const run = await this.run();
      if (run.applied > 0) {
        this.log.log(`Advancement: ${run.applied} levels moved by age across ${run.tenants} clubs`);
      }
    } catch (error) {
      this.log.error('The advancement pass failed tonight', error as Error);
    }
  }

  async run(organizationId?: string): Promise<{ tenants: number; applied: number }> {
    const tenants =
      organizationId !== undefined
        ? [organizationId]
        : await withPlatform(async (tx) => {
            const { rows } = await tx.query<{ id: string }>(
              `SELECT id FROM organization
                WHERE advancement_mode = 'apply' AND archived_at IS NULL
                ORDER BY id`,
            );
            return rows.map((row) => row.id);
          });

    let applied = 0;
    for (const tenant of tenants) {
      try {
        const done = await asSystem(tenant, () => applyDueAgeProposals(tenant));
        applied += done.length;
        for (const { noticeId } of done) {
          if (noticeId !== null) void deliverLevelChangeNotice(tenant, noticeId);
        }
      } catch (error) {
        this.log.error(`Advancement pass failed for ${tenant}`, error as Error);
      }
    }
    return { tenants: tenants.length, applied };
  }
}
