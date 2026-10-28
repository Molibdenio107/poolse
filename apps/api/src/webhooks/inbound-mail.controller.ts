import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Webhook } from 'svix';
import { LENEX_MAX_BYTES } from '@poolse/rules/lenex';
import { receiveResults, type IncomingAttachment, type ReceiveOutcome } from '../meets/meet-inbox.repository.js';

/**
 * Inbound mail — POOLSE-114.
 *
 * `POST /webhooks/resend-inbound` is Resend Inbound's `email.received` webhook
 * for the MX of `INBOUND_DOMAIN`. Public (under `webhooks/`), so neither Clerk
 * nor the tenant middleware runs; **the Svix signature is the entire
 * authentication**, checked over the raw bytes before anything is read, and an
 * absent signing secret is a 503 rather than a skipped check — the Stripe
 * webhook's rule. Rate-limited by the API's per-address bucket, and the JSON
 * body is the parser's default ceiling: the webhook carries metadata only.
 *
 * Resend's webhook names the attachments and no more; the bytes come from
 * `GET /emails/receiving/{id}/attachments`, which answers a download URL valid
 * for an hour. Only a `.lef`/`.lxf` is ever fetched, and never past
 * `LENEX_MAX_BYTES`.
 *
 * It answers 200 to everything it understood — an unknown club, a stranger, a
 * duplicate — because the outcome must not be learnable from outside and a
 * provider disables an endpoint that keeps failing. A failure of ours (the
 * database, the bucket) is a 500, and Resend's retry finds the message id.
 *
 * `POST /webhooks/inbound-dev` is the same path without a mail domain: one file
 * as raw bytes, `from`, `to` and `name` in the query. Off unless
 * `INBOUND_DEV_SECRET` is set, and then only with that secret in
 * `x-inbound-dev-secret` — so staging can be tested without DNS, and production,
 * which never sets it, answers 404.
 */

const logger = new Logger('InboundMail');
const RESEND_API = 'https://api.resend.com';

interface ResendReceivedEvent {
  type: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    attachments?: { id?: string; filename?: string }[];
  };
}

interface ResendAttachment {
  id: string;
  filename: string;
  size: number | null;
  download_url: string;
}

@Controller('webhooks')
export class InboundMailController {
  @Post('resend-inbound')
  @HttpCode(HttpStatus.OK)
  async resend(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const event = verify(req);
    if (event.type !== 'email.received') return { received: true };

    const data = event.data ?? {};
    const emailId = typeof data.email_id === 'string' ? data.email_id : '';
    const named = (data.attachments ?? []).filter(
      (attachment) => typeof attachment.filename === 'string' && /\.(lef|lxf)$/i.test(attachment.filename),
    );

    // Fetched lazily and once: a message from a stranger never costs a call.
    let listed: Promise<ResendAttachment[]> | null = null;
    const list = (): Promise<ResendAttachment[]> => (listed ??= listAttachments(emailId));

    const attachments: IncomingAttachment[] = named.map((attachment) => ({
      filename: attachment.filename!,
      size: null,
      load: async () => {
        const found = (await list()).find((item) => item.id === attachment.id);
        if (found === undefined) return Buffer.alloc(0);
        if (found.size !== null && found.size > LENEX_MAX_BYTES) return Buffer.alloc(LENEX_MAX_BYTES + 1);
        return download(found.download_url);
      },
    }));

    log(
      await receiveResults({
        providerMessageId: emailId,
        from: typeof data.from === 'string' ? data.from : '',
        to: Array.isArray(data.to) ? data.to.filter((value): value is string => typeof value === 'string') : [],
        attachments,
      }),
    );
    return { received: true };
  }

  @Post('inbound-dev')
  @HttpCode(HttpStatus.OK)
  async dev(
    @Req() req: Request,
    @Body() body: unknown,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('name') name?: string,
    @Query('messageId') messageId?: string,
  ): Promise<{ outcomes: ReceiveOutcome[] }> {
    const secret = (process.env['INBOUND_DEV_SECRET'] ?? '').trim();
    if (secret === '') throw new NotFoundException();
    const given = Buffer.from(req.header('x-inbound-dev-secret') ?? '');
    const expected = Buffer.from(secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ForbiddenException();

    const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    const outcomes = await receiveResults({
      providerMessageId: messageId?.trim() || `dev-${randomUUID()}`,
      from: from ?? '',
      to: (to ?? '').split(',').map((value) => value.trim()).filter(Boolean),
      attachments:
        name === undefined || name.trim() === ''
          ? []
          : [{ filename: name, size: bytes.length, load: () => Promise.resolve(bytes) }],
    });
    log(outcomes);
    return { outcomes };
  }
}

function log(outcomes: ReceiveOutcome[]): void {
  for (const outcome of outcomes) logger.debug(`inbound: ${outcome.status}`);
}

function verify(req: RawBodyRequest<Request>): ResendReceivedEvent {
  const secret = (process.env['RESEND_INBOUND_WEBHOOK_SECRET'] ?? '').trim();
  if (secret === '') throw new ServiceUnavailableException('Inbound mail is not configured on this installation');
  const payload = req.rawBody;
  if (!payload) throw new UnauthorizedException('Invalid webhook signature');
  try {
    return new Webhook(secret).verify(payload, {
      'svix-id': req.header('svix-id') ?? '',
      'svix-timestamp': req.header('svix-timestamp') ?? '',
      'svix-signature': req.header('svix-signature') ?? '',
    }) as ResendReceivedEvent;
  } catch {
    throw new UnauthorizedException('Invalid webhook signature');
  }
}

async function listAttachments(emailId: string): Promise<ResendAttachment[]> {
  const key = (process.env['RESEND_API_KEY'] ?? '').trim();
  if (key === '' || emailId === '') return [];
  const response = await fetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Resend attachments list answered ${response.status}`);
  const json = (await response.json()) as { data?: Record<string, unknown>[] };
  return (json.data ?? []).flatMap((item) =>
    typeof item['id'] === 'string' && typeof item['download_url'] === 'string'
      ? [
          {
            id: item['id'],
            filename: typeof item['filename'] === 'string' ? item['filename'] : '',
            size: typeof item['size'] === 'number' ? item['size'] : null,
            download_url: item['download_url'],
          },
        ]
      : [],
  );
}

/** At most one byte past the ceiling, so an oversized file is refused without being held whole. */
async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`Attachment download answered ${response.status}`);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
    total += chunk.length;
    if (total > LENEX_MAX_BYTES) break;
  }
  return Buffer.concat(chunks);
}
