import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { classifyAiError, stopFailure, type AiFailure } from './ai-failure';
import { anthropicKeyConfigured, metered } from './ai-meter';

/**
 * Reads a dropped qualification certificate — POOLSE-149 slice D (Rui,
 * 02-11-2026): the certificate is filed and the new-qualification form opens
 * around it, filled with what this reads.
 *
 * - **Gated like every reader** (POOLSE-137): the `qualification_certificate_ai`
 *   switch on /admin, the club's tick, the monthly cap and a key. Off, the form
 *   opens empty around the file and the screen says why.
 * - **It proposes, a person confirms.** Nothing is saved until somebody presses
 *   *Guardar*.
 * - **The type is matched, never created.** The model is given the club's own
 *   type names and answers one of them or null; a certificate for a type the
 *   club does not have leaves the choice to a person.
 * - **Only the certificate goes**, with the club's type names. Nothing about the
 *   person, and the prompt names concepts rather than one issuer's layout.
 */

const MODEL = process.env['POOLSE_QUALIFICATION_CERTIFICATE_MODEL'] ?? 'claude-opus-5-5';
const MAX_BYTES = 10 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CertificateDraft {
  /** The id of the club's type the certificate is for, or null. */
  typeId: string | null;
  issuingBody: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
}

export type CertificateRead =
  | { draft: CertificateDraft }
  | { error: 'off' | 'noKey' | 'capReached' | 'unreadable' | 'nothingFound' | AiFailure };

function system(types: readonly string[]): string {
  return [
    'You read one photograph, scan or PDF of a professional certificate held by a member of staff at a swimming club in Portugal, and transcribe four facts.',
    'Return only what is printed; never infer, never invent. A field you cannot read is null.',
    'type: which of the club\'s own qualification types this certificate is, answered with one name exactly as listed, or null when none of them fits. The list:',
    ...types.map((name) => `- ${name}`),
    'issuingBody: the organisation that issued it, as printed (e.g. an institute, a federation, a training school).',
    'issuedOn: the date it was issued or the course was completed, as YYYY-MM-DD.',
    'expiresOn: the date it stops being valid ("válido até", "validade"), as YYYY-MM-DD; null when none is printed.',
  ].join('\n');
}

function schema(types: readonly string[]): Record<string, unknown> {
  const text = { type: ['string', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'issuingBody', 'issuedOn', 'expiresOn'],
    properties: {
      type: { type: ['string', 'null'], enum: [...types, null] },
      issuingBody: text,
      issuedOn: text,
      expiresOn: text,
    },
  };
}

/** Call only after the reader's gate said null (`aiReaderGate('qualification_certificate', me)`). */
export async function readCertificate(
  bytes: Buffer,
  mediaType: string,
  types: readonly { id: string; name: string }[],
): Promise<CertificateRead> {
  if (!anthropicKeyConfigured()) return { error: 'noKey' };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { error: 'unreadable' };
  const names = types.map((type) => type.name);

  let used: Anthropic.Beta.BetaMessage | null = null;
  const attempt = async (): Promise<CertificateRead> => {
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
          system: system(names),
          messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this certificate.' }] }],
          output_config: { format: { type: 'json_schema', schema: schema(names) } },
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
      const typeName = str(raw['type']);
      const draft: CertificateDraft = {
        typeId: types.find((type) => type.name === typeName)?.id ?? null,
        issuingBody: str(raw['issuingBody'])?.slice(0, 200) ?? null,
        issuedOn: date(raw['issuedOn']),
        expiresOn: date(raw['expiresOn']),
      };
      if (draft.typeId === null && draft.issuingBody === null && draft.issuedOn === null && draft.expiresOn === null) {
        return { error: 'nothingFound' };
      }
      return { draft };
    } catch (error) {
      // Rate limited, timed out, a key that is wrong: the file is filed and the
      // form around it still works.
      return { error: classifyAiError('qualification_certificate', error) };
    }
  };

  // Claimed before, finished after, read or not — POOLSE-137.
  const run = await metered('qualification_certificate', async () => {
    const value = await attempt();
    return { value, succeeded: !('error' in value), response: used };
  });
  return 'gate' in run ? { error: run.gate } : run.value;
}
