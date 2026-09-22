import { Logger } from '@nestjs/common';
import { withPlatform } from '@poolse/db';
import { sendEmail } from '../notifications/notifier.js';
import { platformAlertEmail } from '../notifications/platform-alert-email.js';

const logger = new Logger('PlatformAlert');

/** The transaction handle `withPlatform` hands out. */
type Tx = Parameters<Parameters<typeof withPlatform>[0]>[0];

export type PlatformAlertKind = 'denied' | 'write';

export interface PlatformAlertInput {
  kind: PlatformAlertKind;
  /** The dotted machine key, shared with the audit trail. */
  action: string;
  clerkUserId: string;
  organizationId: string | null;
  /** The club's name, for the message. Read by the caller, which already has it. */
  organizationName: string | null;
  detail: Record<string, unknown>;
}

/** What `recordAlert` hands back, for `deliverAlert` to send after the commit. */
export interface RecordedAlert extends PlatformAlertInput {
  id: string;
  raisedAt: Date;
  /** True when this one is a repeat inside the window and must not be sent. */
  suppressed: boolean;
}

/**
 * Telling somebody, in two halves — POOLSE-64 item 5.
 *
 * **Recorded inside the caller's transaction, sent after it commits.** The same
 * division slice 4.2's water alert makes, and for the same two reasons pulling
 * in opposite directions: an alert written on its own connection can commit
 * while the change it describes rolls back — so the row belongs in the
 * transaction — and an email that fails must never take the change down with it
 * — so the send belongs outside it. `recordAlert` is the first half and
 * `deliverAlert` the second, and a caller that does the first without the second
 * leaves a row saying "recorded, not sent", which is the honest failure rather
 * than a silent one.
 *
 * **One recipient list, from the environment.** `PLATFORM_ALERT_EMAIL` — an ops
 * mailbox, not a person. Resolving operators' own addresses would mean joining
 * `platform_admin` (keyed on the Clerk user id) to `app_user`, whose platform
 * grant is `(id, cached_email)` and carries no `clerk_user_id`: the join does
 * not exist, and widening that grant to make it exist is the ninth-table
 * conversation rather than something taken inside a feature. An unset variable
 * is a legitimate state — the row is written, `delivered_at` stays null, and
 * nothing pretends a message arrived.
 */
export function alertRecipients(): string[] {
  return (process.env['PLATFORM_ALERT_EMAIL'] ?? '')
    .split(/[,;]/)
    .map((address) => address.trim())
    .filter((address) => address !== '');
}

/**
 * Repeats, suppressed for fifteen minutes — the send only, never the row.
 *
 * A refused request is refused per *request*, and the global throttler caps
 * `/platform` well above one a minute: somebody scanning for the area would
 * otherwise produce an inbox full of identical warnings, which is how a channel
 * stops being read before it ever carries something urgent. The same instinct as
 * 4.2's 48-hour window, at a different timescale.
 *
 * **In memory, deliberately.** A second Railway instance sends a second message
 * and a deploy resets the window; both are acceptable for a suppression whose
 * only job is to turn a flood into a message. Storing it would mean a write on
 * the path of a request that has already been refused.
 *
 * Writes are never suppressed. An operator makes a handful of changes a day, and
 * "these three clubs were suspended in one minute" is exactly the sentence this
 * is for.
 */
const SUPPRESS_WINDOW_MS = 15 * 60 * 1000;
const lastSent = new Map<string, number>();

function suppress(input: PlatformAlertInput, now: number): boolean {
  if (input.kind !== 'denied') return false;

  const key = `${input.kind}:${input.clerkUserId}`;
  const previous = lastSent.get(key);

  if (previous !== undefined && now - previous < SUPPRESS_WINDOW_MS) return true;

  lastSent.set(key, now);

  // The map is keyed on whoever has been refused, so a determined stranger with
  // many accounts is the only way it grows. Swept rather than capped: an entry
  // past its window has no effect on anything.
  if (lastSent.size > 500) {
    for (const [seen, at] of lastSent) {
      if (now - at >= SUPPRESS_WINDOW_MS) lastSent.delete(seen);
    }
  }

  return false;
}

/**
 * Write the row, inside the transaction that produced the event.
 *
 * The suppression decision is taken *here* rather than at send time, because
 * `detail` says which state the row is in and there is no UPDATE grant on that
 * column — the grant is `(recipients, delivered_at)` and nothing else. So a row
 * that will not be sent says so from the moment it is written, and "recorded,
 * not sent" can be read apart from "nothing was ever tried".
 */
export async function recordAlert(tx: Tx, input: PlatformAlertInput): Promise<RecordedAlert> {
  const now = Date.now();
  const suppressed = suppress(input, now);

  const { rows } = await tx.query<{ id: string; raised_at: Date }>(
    `INSERT INTO platform_alert (kind, action, clerk_user_id, organization_id, detail)
          VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, raised_at`,
    [
      input.kind,
      input.action,
      input.clerkUserId,
      input.organizationId,
      JSON.stringify(
        suppressed ? { ...input.detail, delivery: 'suppressed_repeat' } : input.detail,
      ),
    ],
  );

  const row = rows[0]!;
  return { ...input, id: row.id, raisedAt: row.raised_at, suppressed };
}

/**
 * Send it, and stamp what the send actually did. Never throws.
 *
 * Called *after* the recording transaction has committed. Everything it can go
 * wrong on — no provider, no address, a provider that refuses, a stamp that
 * loses a race — ends as a logged warning and a row that says the message did
 * not go, because the alternative is a platform action failing on the mail
 * server's behalf.
 *
 * **One message per recipient**, as the water alert does: a list of addresses in
 * a To field is a list every recipient can then read, and one bad address must
 * not take the rest down with it.
 */
export async function deliverAlert(alert: RecordedAlert): Promise<void> {
  if (alert.suppressed) return;

  try {
    const to = alertRecipients();
    let delivered = false;

    for (const address of to) {
      const sent = await sendEmail(
        platformAlertEmail({
          to: address,
          kind: alert.kind,
          action: alert.action,
          clerkUserId: alert.clerkUserId,
          organizationId: alert.organizationId,
          organizationName: alert.organizationName,
          when: alert.raisedAt,
          detail: alert.detail,
        }),
      );
      // One address that went through is enough to call it delivered; the list
      // is recorded whole either way.
      delivered = delivered || sent;
    }

    await withPlatform(async (tx) => {
      await tx.query(
        `UPDATE platform_alert
            SET recipients = $2::text[],
                delivered_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
          WHERE id = $1`,
        [alert.id, to, delivered],
      );
    });

    if (!delivered) {
      logger.warn(
        `Platform alert ${alert.action} recorded and not sent` +
          (to.length === 0 ? ' — PLATFORM_ALERT_EMAIL is not set' : ''),
      );
    }
  } catch (error) {
    logger.warn(
      `Could not deliver platform alert ${alert.id}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
