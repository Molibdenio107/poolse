import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { withOrg, withPlatform } from '@poolse/db';

export interface RetentionRun {
  tenants: number;
  healthErased: number;
  anonymised: number;
  leadsAnonymised: number;
}

/**
 * The nightly retention pass — roadmap 7b.8, Rui 16-10-2026.
 *
 * A year after a student leaves, their health data is erased. Five years after,
 * their identity is replaced with a placeholder, and the incidents that name
 * them lose their words. The rules live in one database function,
 * `apply_retention()`, because most of that data sits in tables the app may not
 * rewrite. This only lists the clubs and calls it inside each one's context.
 *
 * Every club, archived and suspended included: retention is about the data,
 * not the door. Idempotent, so a second instance running the same night does
 * nothing twice. One club's failure is logged and the sweep goes on.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  @Cron('30 3 * * *', { timeZone: 'Europe/Lisbon' })
  async tick(): Promise<void> {
    try {
      const run = await this.run();
      this.log.log(
        `Retention: ${run.healthErased} health records erased, ${run.anonymised} students ` +
          `and ${run.leadsAnonymised} leads anonymised across ${run.tenants} clubs`,
      );
    } catch (error) {
      this.log.error('The retention sweep failed tonight', error as Error);
    }
  }

  async run(organizationId?: string): Promise<RetentionRun> {
    const tenants =
      organizationId !== undefined
        ? [organizationId]
        : await withPlatform(async (tx) => {
            const { rows } = await tx.query<{ id: string }>('SELECT id FROM organization ORDER BY id');
            return rows.map((row) => row.id);
          });

    const total: RetentionRun = { tenants: tenants.length, healthErased: 0, anonymised: 0, leadsAnonymised: 0 };
    for (const tenant of tenants) {
      try {
        const done = await withOrg(tenant, async (tx) => {
          const { rows } = await tx.query<{
            health_erased: number;
            anonymised: number;
            leads_anonymised: number;
          }>('SELECT * FROM apply_retention()');
          return rows[0]!;
        });
        total.healthErased += done.health_erased;
        total.anonymised += done.anonymised;
        total.leadsAnonymised += done.leads_anonymised;
      } catch (error) {
        this.log.warn(`Retention failed for ${tenant}: ${String(error)}`);
      }
    }
    return total;
  }
}
