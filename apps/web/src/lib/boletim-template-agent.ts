import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { BOLETIM_FIELDS, placementsFromGrid, type BoletimField, type BoletimPlacement } from '@poolse/rules';
import { anthropicKeyConfigured, metered } from './ai-meter';

/**
 * Proposes where each Poolse field goes on a club's own boletim — POOLSE-142
 * slice B (Rui, 01-11-2026: "the AI places the fields").
 *
 * - **Gated like every reader** (POOLSE-137): the `boletim_template_ai` switch
 *   on /admin, the club's tick, the monthly cap and a key. Off, the manual
 *   editor is the way, and the screen says why nothing was proposed.
 * - **It proposes, a person confirms.** The positions load into the editor
 *   unsaved; nothing is written until somebody presses *Guardar posições*.
 * - **Only the form goes**: the club's blank (or sample) form and the list of
 *   fields. Nothing about any student, and nothing about the club.
 * - **A 0–1000 grid**, converted to page fractions here: a model places whole
 *   numbers on a grid more steadily than it writes four-decimal fractions.
 */

const MODEL = process.env['POOLSE_BOLETIM_TEMPLATE_MODEL'] ?? 'claude-opus-5-5';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PLACEMENTS = 60;

/** What each field means on a Portuguese membership form — the model's only vocabulary. */
const MEANING: Record<BoletimField, string> = {
  name: 'the member\'s full name ("Nome")',
  parent_one_name: 'the first parent\'s name ("Filho de", "Filiação", "Pai")',
  parent_two_name: 'the second parent\'s name (the "e de" line after "Filho de", "Mãe")',
  birth_date: 'the whole date of birth, only where the form has one blank for it ("Data de nascimento")',
  birth_day: 'the day of birth, where the form writes "Nascido em __ de ____ de ____" (the first blank)',
  birth_month: 'the month of birth in words (the second blank of "Nascido em __ de ____ de ____")',
  birth_year: 'the year of birth (the third blank of "Nascido em __ de ____ de ____")',
  marital_status: 'marital status ("Estado", "Estado civil")',
  profession: 'profession ("Profissão")',
  education: 'education ("Habilitações")',
  birthplace: 'place of birth ("Naturalidade")',
  nationality: 'nationality ("Nacionalidade")',
  address_line: 'street address ("Residente em", "Morada")',
  locality: 'town ("Localidade")',
  postal_code: 'postcode ("Código Postal")',
  phone: 'mobile phone ("Telem.", "Telemóvel"; use the mobile line where there is also a landline "Telef.")',
  email: 'email ("Email")',
  tax_number: 'tax number ("N.I.F.", "NIF", "Contribuinte")',
  id_document_number: 'identity document number ("B.I./C.C.", "Cartão de Cidadão")',
  sns_number: 'national health service number ("N.º Utente", "SNS")',
  socio_number: 'the member number ("N.º", "N.º de sócio"), only if the form leaves it for the club to fill',
  socio_since: '"Sócio desde", only if the form has it',
  guardian_name: 'the guardian\'s name ("Encarregado de educação")',
  guardian_phone: 'the guardian\'s phone',
  guardian_email: 'the guardian\'s email',
  guardian_relationship: 'the guardian\'s relationship to the member ("Parentesco")',
  today: 'the date of signing, only where it is one blank ("Data")',
  today_day: 'the day of signing, where the form writes "____, __ de ____ de 20__" (the day blank)',
  today_month: 'the month of signing in words (the month blank of that line)',
  today_year: 'the full year of signing, where the form leaves a whole year blank',
  today_year_short: 'the last two digits of the year of signing, where the form prints "20" before the blank',
};

const SYSTEM = [
  'You look at one scanned page of a Portuguese club\'s membership form ("Proposta de Sócio", "Boletim de sócio") and say where a clerk would write each piece of data.',
  'Coordinates are on a 0–1000 grid over the whole image: x from the left edge, y from the top edge.',
  'For each field the form asks for, give the point where the handwriting starts: x just after the printed label (at the start of the blank line), y on the blank line itself (the baseline the writing sits on).',
  'Only fields the form actually asks for. Never invent a blank. Skip a field the form does not have; skip boxes to tick and the club\'s own sections (approval, direction signatures, "Admitido em sessão").',
  'Ignore anything already handwritten or typed in the blanks: place the field where it would be written.',
  'A field may appear twice only if the form asks for it twice.',
  'The fields:',
  ...BOLETIM_FIELDS.map((field) => `- ${field}: ${MEANING[field]}`),
].join('\n');

function schema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['placements'],
    properties: {
      placements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'x', 'y'],
          properties: {
            field: { type: 'string', enum: [...BOLETIM_FIELDS] },
            x: { type: 'integer' },
            y: { type: 'integer' },
          },
        },
      },
    },
  };
}

/** `off`, `noKey` and `capReached` mean the call was never made (POOLSE-137). */
export type BoletimLayoutRead =
  | { placements: BoletimPlacement[] }
  | { error: 'off' | 'noKey' | 'capReached' | 'unreadable' | 'nothingFound' };

/** Call only after the gate (`readAiReaderGate('boletim_template')`) said null. */
export async function readBoletimLayout(bytes: Buffer, mediaType: string): Promise<BoletimLayoutRead> {
  if (!anthropicKeyConfigured()) return { error: 'noKey' };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { error: 'unreadable' };
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') return { error: 'unreadable' };

  let used: Anthropic.Beta.BetaMessage | null = null;
  const attempt = async (): Promise<BoletimLayoutRead> => {
    try {
      const client = new Anthropic();
      const response = await client.beta.messages.create(
        {
          model: MODEL,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          max_tokens: 4096,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } },
                { type: 'text', text: 'Where does each field go on this form?' },
              ],
            },
          ],
          output_config: { format: { type: 'json_schema', schema: schema() } },
        },
        { timeout: 90_000 },
      );
      used = response;
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return { error: 'unreadable' };
      const text = response.content
        .filter((part): part is Anthropic.Beta.BetaTextBlock => part.type === 'text')
        .map((part) => part.text)
        .join('');
      if (text.trim() === '') return { error: 'nothingFound' };
      const placements = placementsFromGrid(JSON.parse(text), MAX_PLACEMENTS);
      return placements.length === 0 ? { error: 'nothingFound' } : { placements };
    } catch {
      // Rate limited, timed out, a key that is wrong: the manual editor still works.
      return { error: 'unreadable' };
    }
  };

  // Claimed before, finished after, read or not — POOLSE-137.
  const run = await metered('boletim_template', async () => {
    const value = await attempt();
    return { value, succeeded: !('error' in value), response: used };
  });
  return 'gate' in run ? { error: run.gate } : run.value;
}
