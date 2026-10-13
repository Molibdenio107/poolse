import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withPlatform } from '@poolse/db';
import { archiveStaleLeads } from './leads.repository.js';

/**
 * Archives unconverted leads past `lead_retention()` — POOLSE-69, 12 months
 * (decisions, 13-10-2026). Daily, per club, inside each club's own policy: the
 * platform login only lists the clubs, and could not touch a lead if it tried.
 *
 * Idempotent by construction — a lead archived yesterday is not stale today —
 * so a second instance running the same sweep archives nothing twice.
 * Suspended clubs are swept too: retention is about the data, not the door.
 */
@Injectable()
export class LeadRetentionService {
  private readonly log = new Logger(LeadRetentionService.name);

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.log.error('The lead retention sweep failed today', error as Error);
    }
  }

  async run(organizationId?: string): Promise<{ tenants: number; archived: number }> {
    const tenants =
      organizationId !== undefined
        ? [organizationId]
        : await withPlatform(async (tx) => {
            const { rows } = await tx.query<{ id: string }>(
              `SELECT id FROM organization
                WHERE archived_at IS NULL AND kind = 'business'
                ORDER BY id`,
            );
            return rows.map((row) => row.id);
          });

    let archived = 0;
    for (const tenant of tenants) {
      try {
        archived += await archiveStaleLeads(tenant);
      } catch (error) {
        this.log.warn(`Lead retention failed for ${tenant}: ${String(error)}`);
      }
    }
    return { tenants: tenants.length, archived };
  }
}
