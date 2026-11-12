import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { checkedSchema } from './ai-schema';
import { classifyAiError, stopFailure } from './ai-failure';
import { anthropicKeyConfigured, metered } from './ai-meter';
import {
  INVOICE_HEADER_FIELDS,
  LINE_FIELDS,
  LINE_KINDS,
  REGISTERS,
  REGISTER_FIELDS,
  TARIFF_PERIODS,
  readInvoiceDraft,
  type EnergyInvoiceParser,
  type InvoiceParseResult,
  type ReportFile,
} from './energy-invoice';

/**
 * The import agent that reads an electricity bill — slice 5.3.
 *
 * The one implementation of `EnergyInvoiceParser` this build ships. What a
 * bill *is* lives in `energy-invoice.ts`, which is pure; this file is the API
 * key, the document block and the prompt, and nothing else. Same three rules
 * as `analysis-report-agent.ts`:
 *
 * - **Optional, off by default.** Its platform switch and the club's tick on
 *   /admin (POOLSE-137), and `ANTHROPIC_API_KEY`. Without all three, dropping
 *   a PDF says so in a sentence rather than failing. A bill carries the
 *   holder's name, NIF and address, and a club turns this on knowing that the
 *   document goes to the model's API — the feature page says so.
 * - **Only the document is sent.** Not the club, not its meters, not the bills
 *   before it. The model is asked to read a page, not to reason about a customer.
 * - **Nothing it says is written.** The answer lands on the same form a person
 *   fills in, goes through the same preview on the API, and a person confirms.
 *
 * **The prompt describes concepts, never a layout.** EDP, Galp, Iberdrola and
 * Goldenergy print the same facts in different places; a prompt that knew
 * where EDP puts the CPE would be wrong for the next one. So it names what to
 * look for — the electricity fatura inside the document, the delivery point,
 * the registers on the dial, the billed lines with their VAT — and the strict
 * tool schema is the contract.
 */

const MODEL = process.env['POOLSE_ENERGY_INVOICE_MODEL'] ?? 'claude-opus-5-5';

/** A bill is a handful of pages; anything past this is not one. */
export const MAX_BYTES = 12 * 1024 * 1024;

/**
 * The reply's shape — structured output rather than a forced tool call
 * (POOLSE-106, before switching the reading on): the current Opus refuses a
 * forced `tool_choice`, the move the PDF and water readers already made.
 */
function invoiceSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ...HEADER_PROPERTIES,
      registers: {
        type: 'array',
        description: 'One entry per register on the dial. A field not printed is an empty string.',
        items: {
          type: 'object',
          properties: Object.fromEntries(
            REGISTER_FIELDS.map((field) =>
              field === 'register'
                ? [field, { type: 'string', enum: [...REGISTERS] }]
                : [field, { type: 'string' }],
            ),
          ),
          required: [...REGISTER_FIELDS],
          additionalProperties: false,
        },
      },
      lines: {
        type: 'array',
        description: 'Every billed row of the electricity fatura, in order.',
        items: {
          type: 'object',
          properties: Object.fromEntries(
            LINE_FIELDS.map((field) =>
              field === 'kind'
                ? [field, { type: 'string', enum: [...LINE_KINDS] }]
                : field === 'period'
                  ? [field, { type: 'string', enum: [...TARIFF_PERIODS, ''] }]
                  : [field, { type: 'string' }],
            ),
          ),
          required: [...LINE_FIELDS],
          additionalProperties: false,
        },
      },
    },
    // Every field required, "" when not printed ("" is in each enum too): 35
    // optional fields made the API answer 400 "Schema is too complex" — the
    // water reader hit it on 12-11-2026. readInvoiceDraft reads "" as absent.
    required: [...INVOICE_HEADER_FIELDS, 'registers', 'lines'],
    additionalProperties: false,
  };
}

const SYSTEM = [
  'You read Portuguese utility bills for a swimming pool — electricity, natural',
  'gas or water — and extract the charges as structured data. Suppliers differ',
  '(EDP, Galp, Iberdrola, Goldenergy, Endesa, a municipal water utility, others)',
  'and layouts differ completely; look for the facts, not for a layout.',
  '',
  'One document often bundles several faturas: electricity, gas, a television',
  'licence (Contribuição Audiovisual), a services pack, a debit or credit note.',
  'Extract ONE fatura: the electricity one when there is one, otherwise the gas',
  'one, otherwise the water one. Its number, ATCUD, subtotal, VAT and total are',
  'that fatura\'s. Everything else in the document goes into "otherCharges" as',
  'one sum, so that "documentTotal" — the amount the document says to pay —',
  'equals that fatura\'s total plus otherCharges.',
  '',
  'A gas fatura charges m³ turned into kWh: put the m³ consumed in "volumeM3"',
  'and the conversion factor (kWh/m³, "fator de conversão") in',
  '"conversionFactor"; its energy lines are in kWh. Its supply point is the CUI',
  '(starts PT16 and ends GN) and goes in "cpe". A water fatura charges m³: put',
  'them in "volumeM3"; it has no CPE (leave "cpe" empty), no registers and no',
  'conversion factor. For an electricity fatura leave both empty.',
  "Registers are an electricity meter's dials only: for gas and water leave",
  '"registers" as an empty list; their m³ are in "volumeM3".',
  '',
  'subtotal is the sum of every billed electricity line before VAT, INCLUDING',
  'taxes such as DGEG and IEC that are listed with their own line. vat is the',
  'VAT alone. total is subtotal plus vat. If the bill groups taxes and VAT in',
  'one block, separate them: the tax lines go to the lines, their VAT to vat.',
  '',
  'Registers are what the meter dial shows: vazio, ponta, cheias, super vazio,',
  'or total, each with a previous and current reading and the kWh between them.',
  'A Simples tariff still has several registers; the supplier sums them.',
  '',
  'Lines are every billed row of the fatura, in order, each with a kind:',
  '"energy" for electricity or gas consumption (kWh), "power" for potência',
  'contratada per day, "fixed" for a termo fixo or tarifa de disponibilidade,',
  '"water" for water by m³, "sanitation" for saneamento, "waste" for resíduos,',
  '"discount" for a negative row (desconto, tarifa social), "tax" for DGEG,',
  'IEC, ISP, taxa de recursos hídricos and similar, "other" for anything else.',
  'Copy the description as printed. Give the tariff period for energy lines (simples,',
  'ponta, cheias, vazio_normal, super_vazio, fora_vazio, vazio), the date range,',
  'the quantity with its unit (kWh, dias, mês), the unit price, the amount before',
  'discount, the discount as a positive figure, the total before VAT, and the VAT',
  'rate as a percentage (6, 23). A discount printed on the same row as a charge',
  'goes in that row\'s "discount"; a discount printed as its own row is a',
  '"discount" line with a negative amount.',
  '',
  'Copy numbers exactly as written, including the decimal comma — never convert,',
  'never round. Dates as printed. The CPE (Código do Ponto de Entrega) as',
  'printed, spaces included. meterSerial is the number printed beside the dial',
  'readings. readingQuality is "real" or "estimated" as the bill says.',
  'networkAccess is the "acesso às redes" total before VAT when stated;',
  'regulatedDifference is the signed difference against the regulated tariff',
  'when stated. If a value is illegible or absent, leave it an empty string rather than',
  'guessing: a missing figure is a question on the form, a guessed one is a',
  'wrong bill.',
  '',
  `"notes" stays empty unless something on the bill needs a person's attention`,
  '(an estimated reading, a correction, a debt); then write it briefly in',
  'European Portuguese (pt-PT), never in English.',
].join('\n');

const HEADER_PROPERTIES = Object.fromEntries(
  INVOICE_HEADER_FIELDS.map((field) =>
    field === 'readingQuality'
      ? [field, { type: 'string', enum: ['real', 'estimated', ''] }]
      : [field, { type: 'string' }],
  ),
);

export class ClaudeEnergyInvoiceParser implements EnergyInvoiceParser {
  available(): boolean {
    return anthropicKeyConfigured();
  }

  async parse(file: ReportFile): Promise<InvoiceParseResult> {
    if (!this.available()) return { error: 'noKey' };
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_BYTES) {
      return { error: 'unreadable' };
    }

    let used: Anthropic.Beta.BetaMessage | null = null;
    const attempt = async (): Promise<InvoiceParseResult> => {
    try {
      const client = new Anthropic();

      // Streamed, like every document reader: a long bill with thinking is a
      // long answer, and a short cap or timeout reads as a broken file.
      const response = await client.beta.messages
        .stream(
        {
          model: MODEL,
          // A declined read is retried on the model the API picks, inside the
          // same call — as the PDF table reader does.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          max_tokens: 64000,
          thinking: { type: 'adaptive' },
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                documentBlock(file),
                { type: 'text', text: 'Extract the electricity fatura in this document.' },
              ],
            },
          ],
          output_config: { format: { type: 'json_schema', schema: checkedSchema('energy_invoice', invoiceSchema()) } },
        },
        // Five minutes, as the timetable and water readers.
        { timeout: 300_000 },
      )
        .finalMessage();
      used = response;

      const stopped = stopFailure(response.stop_reason);
      if (stopped !== null) return { error: stopped };
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text.trim() === '') return { error: 'nothingFound' };

      const draft = readInvoiceDraft(JSON.parse(text));
      return draft === null ? { error: 'nothingFound' } : { draft };
    } catch (error) {
      // Rate limited, timed out, misconfigured key, network, a PDF the API
      // refuses. All the same to the operator: this document could not be
      // read, and the form beside it still works.
      return { error: classifyAiError('energy_invoice', error) };
    }
    };

    // Claimed before, finished after, read or not — POOLSE-137.
    const run = await metered('energy_invoice', async () => {
      const value = await attempt();
      return { value, succeeded: !('error' in value), response: used };
    });
    return 'gate' in run ? { error: run.gate } : run.value;
  }
}

/** Read when a bill arrives, not at import — so a deployment can turn it on without a rebuild. */
export function energyInvoiceParser(): EnergyInvoiceParser {
  return new ClaudeEnergyInvoiceParser();
}

function documentBlock(file: ReportFile): Anthropic.Beta.BetaContentBlockParam {
  const data = file.bytes.toString('base64');
  return file.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } };
}
