import webpush from 'web-push';
import { withOrg } from '@poolse/db';

/**
 * Web Push — POOLSE-90 slice 4. A second channel on a recorded notice, never
 * instead of one: the email is what is retried, and a push is sent once.
 *
 * **Off unless all three VAPID variables are set** — the `STRIPE_SECRET_KEY`
 * pattern: with any missing, `GET /push/config` says so, the switch explains it,
 * and `pushTo` does nothing. No provider and no cost: the browser's own push
 * service delivers it.
 *
 * A 404 or 410 from the push service means that device is gone; its row is
 * revoked and never tried again. Any other failure is left for next time,
 * because one bad night on a push service is not a device that has gone away.
 */

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let configured: PushConfig | null | undefined;

export function pushConfig(): PushConfig | null {
  if (configured !== undefined) return configured;
  const publicKey = process.env['VAPID_PUBLIC_KEY']?.trim() ?? '';
  const privateKey = process.env['VAPID_PRIVATE_KEY']?.trim() ?? '';
  const subject = process.env['VAPID_SUBJECT']?.trim() ?? '';
  if (publicKey === '' || privateKey === '' || !/^(mailto:.+|https:\/\/.+)$/.test(subject)) {
    configured = null;
  } else {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = { publicKey, privateKey, subject };
  }
  return configured;
}

/** For tests: forget what was read, so a test can set or clear the variables. */
export function resetPushConfig(): void {
  configured = undefined;
}

/** What a notification says and where tapping it goes — the app's own path. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushSubscriptionRow {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
}

/** Turns this device on for this person, or refreshes its keys if it already is. */
export async function saveSubscription(
  organizationId: string,
  membershipId: string,
  input: { endpoint: string; p256dh: string; auth: string; label: string | null },
): Promise<{ id: string }> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO push_subscription (organization_id, membership_id, endpoint, p256dh, auth, label)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, membership_id, endpoint) WHERE revoked_at IS NULL
       DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label
       RETURNING id`,
      [organizationId, membershipId, input.endpoint, input.p256dh, input.auth, input.label],
    );
    return { id: rows[0]!.id };
  });
}

/** This person's live devices. */
export async function listOwnSubscriptions(organizationId: string, membershipId: string): Promise<PushSubscriptionRow[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<PushSubscriptionRow>(
      `SELECT id, label,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              to_char(last_success_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSuccessAt"
         FROM push_subscription
        WHERE membership_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [membershipId],
    );
    return rows;
  });
}

/**
 * Turns one of this person's devices off — by id, or by the endpoint the
 * browser holds (the switch knows the endpoint, not our id). Another person's
 * row is simply not found.
 */
export async function revokeOwnSubscription(
  organizationId: string,
  membershipId: string,
  key: { id: string } | { endpoint: string },
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE push_subscription SET revoked_at = now()
        WHERE membership_id = $1 AND revoked_at IS NULL
          AND ${'id' in key ? 'id = $2::uuid' : 'endpoint = $2'}`,
      [membershipId, 'id' in key ? key.id : key.endpoint],
    );
    return (rowCount ?? 0) > 0;
  });
}

type Sender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<unknown>;

const realSender: Sender = (subscription, payload) =>
  webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 24 });

let defaultSender: Sender = realSender;

/**
 * For tests: route every push through `sender` (null restores the real one), so
 * the paths that push on their own — a stand-in, a closure — can be proved
 * without a push service.
 */
export function usePushSenderForTests(sender: Sender | null): void {
  defaultSender = sender ?? realSender;
}

/**
 * Pushes one notice to these people's live devices. Best effort, once, never
 * awaited by a request: a failure is logged by the push service's status and a
 * gone device is revoked. Answers how many devices took it.
 */
export async function pushTo(
  organizationId: string,
  membershipIds: readonly string[],
  payload: PushPayload,
  send: Sender | null = null,
): Promise<number> {
  if (pushConfig() === null || membershipIds.length === 0) return 0;
  const subscriptions = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscription
        WHERE membership_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [membershipIds],
    );
    return rows;
  });

  const body = JSON.stringify(payload);
  const delivered: string[] = [];
  const gone: string[] = [];
  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        await (send ?? defaultSender)({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body);
        delivered.push(row.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(row.id);
      }
    }),
  );

  if (delivered.length > 0 || gone.length > 0) {
    await withOrg(organizationId, async (tx) => {
      if (delivered.length > 0) {
        await tx.query(`UPDATE push_subscription SET last_success_at = now() WHERE id = ANY($1::uuid[])`, [delivered]);
      }
      if (gone.length > 0) {
        await tx.query(`UPDATE push_subscription SET revoked_at = now() WHERE id = ANY($1::uuid[])`, [gone]);
      }
    });
  }
  return delivered.length;
}
