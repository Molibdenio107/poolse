import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
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
 * - **Optional, off by default.** `ENERGY_INVOICE_AI_ENABLED=true` says the
 *   club wants it; `ANTHROPIC_API_KEY` says it can work. Without both, dropping
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

const MODEL = process.env['POOLSE_ENERGY_INVOICE_MODEL'] ?? 'claude-opus-5';

/** A bill is a handful of pages; anything past this is not one. */
const MAX_BYTES = 12 * 1024 * 1024;

const TOOL_NAME = 'record_invoice';

const SYSTEM = [
  'You read Portuguese electricity bills (faturas de eletricidade) and extract',
  'the electricity charges as structured data. Suppliers differ — EDP, Galp,',
  'Iberdrola, Goldenergy, Endesa, others — and layouts differ completely; look',
  'for the facts, not for a layout.',
  '',
  'One document often bundles several faturas: electricity, a television licence',
  '(Contribuição Audiovisual), a services pack, gas, a debit or credit note.',
  'Extract the ELECTRICITY fatura only. Its number, ATCUD, subtotal, VAT and',
  'total are the electricity ones. Everything else in the document goes into',
  '"otherCharges" as one sum, so that "documentTotal" — the amount the document',
  'says to pay — equals the electricity total plus otherCharges.',
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
  'Lines are every billed row of the electricity fatura, in order, each with a',
  'kind: "energy" for consumption by tariff period, "power" for potência',
  'contratada per day, "discount" for a negative row (desconto, tarifa social),',
  '"tax" for DGEG, IEC, and similar, "other" for anything else. Copy the',
  'description as printed. Give the tariff period for energy lines (simples,',
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
  'when stated. If a value is illegible or absent, omit that field rather than',
  'guessing: an omitted figure is a question on the form, a guessed one is a',
  'wrong bill.',
].join('\n');

const HEADER_PROPERTIES = Object.fromEntries(
  INVOICE_HEADER_FIELDS.map((field) =>
    field === 'readingQuality'
      ? [field, { type: 'string', enum: ['real', 'estimated'] }]
      : [field, { type: 'string' }],
  ),
);

export class ClaudeEnergyInvoiceParser implements EnergyInvoiceParser {
  available(): boolean {
    return (
      (process.env['ENERGY_INVOICE_AI_ENABLED'] ?? '').trim().toLowerCase() === 'true' &&
      (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== ''
    );
  }

  async parse(file: ReportFile): Promise<InvoiceParseResult> {
    if (!this.available()) return { error: 'disabled' };
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_BYTES) {
      return { error: 'unreadable' };
    }

    try {
      const client = new Anthropic();

      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: 8192,
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
          tools: [
            {
              name: TOOL_NAME,
              description: 'Record the electricity bill found in the document.',
              strict: true,
              input_schema: {
                type: 'object',
                properties: {
                  ...HEADER_PROPERTIES,
                  registers: {
                    type: 'array',
                    description: 'One entry per register on the dial. Omit fields not printed.',
                    items: {
                      type: 'object',
                      properties: Object.fromEntries(
                        REGISTER_FIELDS.map((field) =>
                          field === 'register'
                            ? [field, { type: 'string', enum: [...REGISTERS] }]
                            : [field, { type: 'string' }],
                        ),
                      ),
                      required: ['register'],
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
                              ? [field, { type: 'string', enum: [...TARIFF_PERIODS] }]
                              : [field, { type: 'string' }],
                        ),
                      ),
                      required: ['kind', 'description'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['registers', 'lines'],
                additionalProperties: false,
              },
            },
          ],
          tool_choice: { type: 'tool', name: TOOL_NAME },
        },
        // A five-page bill with thinking is a bigger read than a lab sheet.
        { timeout: 120_000 },
      );

      const call = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' && block.name === TOOL_NAME,
      );
      if (call === undefined) return { error: 'nothingFound' };

      const draft = readInvoiceDraft(call.input);
      return draft === null ? { error: 'nothingFound' } : { draft };
    } catch {
      // Rate limited, timed out, misconfigured key, network, a PDF the API
      // refuses. All the same to the operator: this document could not be
      // read, and the form beside it still works.
      return { error: 'unreadable' };
    }
  }
}

/** Read when a bill arrives, not at import — so a deployment can turn it on without a rebuild. */
export function energyInvoiceParser(): EnergyInvoiceParser {
  return new ClaudeEnergyInvoiceParser();
}

function documentBlock(file: ReportFile): Anthropic.ContentBlockParam {
  const data = file.bytes.toString('base64');
  return file.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } };
}
