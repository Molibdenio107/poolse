import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { classifyAiError, stopFailure, type AiFailure } from './ai-failure';
import type { Me } from './api';
import { aiReaderGate, anthropicKeyConfigured, metered } from './ai-meter';

/**
 * Reads an identification document's photograph — Rui, 30-10-2026: after the
 * photo is uploaded on *Documentos*, the number and dates are filled in.
 *
 * - **Optional, off by default.** The switch on /admin (`id_document_ai`, Rui
 *   30-10-2026), the club's own tick there (POOLSE-137) and an
 *   `ANTHROPIC_API_KEY`: metered calls stay behind their own flag (CLAUDE.md). Off, the photo
 *   is still filed and the fields wait to be typed.
 * - **It proposes, a person confirms.** What it reads fills the form beside the
 *   photo; nothing is saved until somebody presses Guardar.
 * - **Only the image goes.** Nothing else about the student or the club.
 */

const MODEL = process.env['POOLSE_ID_DOCUMENT_MODEL'] ?? 'claude-opus-5-5';
const MAX_BYTES = 10 * 1024 * 1024;

export interface IdDocumentDraft {
  type: 'cc' | 'bi' | 'passport' | 'other' | null;
  number: string | null;
  issuedOn: string | null;
  validUntil: string | null;
}

/** `off`, `noKey` and `capReached` mean the call was never made (POOLSE-137). */
export type IdDocumentRead =
  | { draft: IdDocumentDraft }
  | { error: 'off' | 'noKey' | 'capReached' | 'unreadable' | 'nothingFound' | AiFailure };

const SYSTEM = [
  'You read one photograph or scan of a personal identification document and transcribe four facts.',
  'Return only what is printed; never infer, never invent. A field you cannot read is null.',
  'type: "cc" for a Portuguese Cartão de Cidadão, "bi" for a Bilhete de Identidade, "passport" for a passport, "other" otherwise.',
  'number: the document number as printed. For a Cartão de Cidadão, the civil identification number with its check digit and the two letters and final digit (e.g. 12345678 9 ZZ1) — write it without spaces.',
  'issuedOn and validUntil: dates as YYYY-MM-DD. A Cartão de Cidadão prints only the expiry ("Data de validade"); its issue date is then null.',
].join('\n');

function schema(): Record<string, unknown> {
  const text = { type: ['string', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'number', 'issuedOn', 'validUntil'],
    properties: {
      type: { type: ['string', 'null'], enum: ['cc', 'bi', 'passport', 'other', null] },
      number: text,
      issuedOn: text,
      validUntil: text,
    },
  };
}

/** The key is configured on this server — what /admin shows beside the switch. */
export { anthropicKeyConfigured };

/**
 * Null when the reader may run: switched on for the platform and ticked for
 * this club (as `/me` reports it) and a key to call with. Otherwise which is
 * missing, so the screen can say why nothing was read rather than staying
 * silent. The claim still decides, and may answer that the month's cap is used.
 */
export function idDocumentReaderBlocked(me: Pick<Me, 'aiReaders'>): 'off' | 'noKey' | null {
  return aiReaderGate('id_document', me);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Call only after `idDocumentReaderBlocked` said null. */
export async function readIdDocument(bytes: Buffer, mediaType: string): Promise<IdDocumentRead> {
  if (!anthropicKeyConfigured()) return { error: 'noKey' };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { error: 'unreadable' };

  let used: Anthropic.Beta.BetaMessage | null = null;
  const attempt = async (): Promise<IdDocumentRead> => {
  try {
    const client = new Anthropic();
    const data = bytes.toString('base64');
    const block: Anthropic.Beta.BetaContentBlockParam =
      mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : {
            type: 'image',
            source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data },
          };
    const response = await client.beta.messages.create(
      {
        model: MODEL,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this identification document.' }] }],
        output_config: { format: { type: 'json_schema', schema: schema() } },
      },
      { timeout: 60_000 },
    );
    used = response;
    { const stopped = stopFailure(response.stop_reason); if (stopped !== null) return { error: stopped }; }
    const text = response.content
      .filter((part): part is Anthropic.Beta.BetaTextBlock => part.type === 'text')
      .map((part) => part.text)
      .join('');
    if (text.trim() === '') return { error: 'nothingFound' };
    const raw = JSON.parse(text) as Record<string, unknown>;
    const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
    const date = (value: unknown): string | null => {
      const v = str(value);
      return v !== null && DATE.test(v) ? v : null;
    };
    const type = str(raw['type']);
    const draft: IdDocumentDraft = {
      type: type === 'cc' || type === 'bi' || type === 'passport' || type === 'other' ? type : null,
      number: str(raw['number'])?.replace(/\s+/g, '').toUpperCase() ?? null,
      issuedOn: date(raw['issuedOn']),
      validUntil: date(raw['validUntil']),
    };
    if (draft.number === null && draft.validUntil === null) return { error: 'nothingFound' };
    return { draft };
  } catch (error) {
    // Rate limited, timed out, a key that is wrong: the photo is filed and the
    // form beside it still works.
    return { error: classifyAiError('id_document', error) };
  }
  };

  // Claimed before, finished after, read or not — POOLSE-137.
  const run = await metered('id_document', async () => {
    const value = await attempt();
    return { value, succeeded: !('error' in value), response: used };
  });
  return 'gate' in run ? { error: run.gate } : run.value;
}
