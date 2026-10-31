import { withOrg, withoutTenantScope } from '@poolse/db';
import { AI_READER_SWITCH, AI_READERS, effectiveAiReaders, type AiReader } from '@poolse/rules';

/**
 * A model call by one of the AI readers, claimed before and finished after —
 * POOLSE-137.
 *
 * **Claim, then finish, so the cap holds under two tabs.** The claim takes an
 * advisory lock on the club, checks the platform switch, the club's tick and
 * this month's count against the cap, and writes the row in the same
 * transaction — so two claims at once cannot both see "one left". The row is
 * the count: a call that crashed between claim and finish was still possibly
 * paid for, so it stays counted and reads as failed once it is an hour old.
 */

/** Why a claim was refused. The web app turns each into its own sentence. */
export type AiClaimRefusal = 'ai_reader_off' | 'ai_cap_reached';

export class AiClaimRefusedError extends Error {
  constructor(readonly code: AiClaimRefusal) {
    super(code);
  }
}

/** The Lisbon month a read counts in — one definition, read by the cap and the card alike. */
export const THIS_LISBON_MONTH = `date_trunc('month', now() AT TIME ZONE 'Europe/Lisbon')`;

/** The readers that may run for this club now: ticked here and on for the platform. */
export async function effectiveReadersFor(organizationId: string): Promise<AiReader[]> {
  const [ticked, switches] = await Promise.all([
    withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{ ai_readers: string[] }>(
        // An enum array: ::text[], never bare (the slice 4.2 lesson).
        'SELECT ai_readers::text[] AS ai_readers FROM organization WHERE id = $1',
        [organizationId],
      );
      return rows[0]?.ai_readers ?? [];
    }),
    readSwitchMap(),
  ]);
  return effectiveAiReaders(ticked, switches);
}

/** Every platform switch by name; unreadable reads as an empty map, which is every reader off. */
async function readSwitchMap(): Promise<Record<string, boolean>> {
  try {
    return await withoutTenantScope(async (tx) => {
      const { rows } = await tx.query<{ name: string; enabled: boolean }>('SELECT name, enabled FROM platform_switch');
      return Object.fromEntries(rows.map((row) => [row.name, row.enabled]));
    });
  } catch {
    return {};
  }
}

export async function claimRead(organizationId: string, reader: AiReader): Promise<{ id: string }> {
  return withOrg(organizationId, async (tx) => {
    // One claim at a time per club, for the length of this transaction.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('ai_read:' || $1, 0))`, [organizationId]);

    const { rows } = await tx.query<{ ticked: boolean; cap: number | null; switched_on: boolean | null; used: number }>(
      `SELECT $2::ai_reader = ANY (o.ai_readers) AS ticked,
              o.ai_monthly_cap AS cap,
              (SELECT s.enabled FROM platform_switch s WHERE s.name = $3) AS switched_on,
              (SELECT count(*)::int FROM ai_read r
                WHERE r.organization_id = o.id
                  AND r.claimed_at AT TIME ZONE 'Europe/Lisbon' >= ${THIS_LISBON_MONTH}) AS used
         FROM organization o
        WHERE o.id = $1`,
      [organizationId, reader, AI_READER_SWITCH[reader]],
    );
    const club = rows[0];
    if (club === undefined || !club.ticked || club.switched_on !== true) {
      throw new AiClaimRefusedError('ai_reader_off');
    }
    if (club.cap !== null && club.used >= club.cap) throw new AiClaimRefusedError('ai_cap_reached');

    const inserted = await tx.query<{ id: string }>(
      'INSERT INTO ai_read (organization_id, reader) VALUES ($1, $2) RETURNING id',
      [organizationId, reader],
    );
    return { id: inserted.rows[0]!.id };
  });
}

export interface ReadOutcome {
  succeeded: boolean;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Fill a claimed row in, once. False when there is no such unfinished row in
 * this club — already finished, another club's (RLS hides it), or never made.
 */
export async function finishRead(organizationId: string, id: string, outcome: ReadOutcome): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE ai_read
          SET finished_at = now(), succeeded = $3, model = $4, input_tokens = $5, output_tokens = $6
        WHERE id = $1 AND organization_id = $2 AND finished_at IS NULL`,
      [id, organizationId, outcome.succeeded, outcome.model, outcome.inputTokens, outcome.outputTokens],
    );
    return (rowCount ?? 0) > 0;
  });
}

export { AI_READERS };
