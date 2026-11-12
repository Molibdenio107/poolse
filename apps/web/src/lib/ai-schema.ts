/**
 * The reply format every AI reader sends, checked before it costs anything —
 * 12-11-2026.
 *
 * Two readers shipped a `json_schema` the API refuses, and the club saw "the AI
 * refused this file" on a perfectly clean PDF: the water reader had 22 optional
 * fields ("Schema is too complex"), the ID reader a nullable enum written as
 * `type: [string, null]` with `null` in the enum. Each reader now passes its
 * schema through `checkedSchema`, which throws `ReplySchemaError` for either
 * shape; `classifyAiError` reads that as `readerFault` (Poolse's bug), and no
 * request is sent.
 *
 * The rules, for a new reader:
 * - **Every property required.** A value not on the document is `""` (or null
 *   through `anyOf`), never an omitted key; an enum that may be absent lists `""`.
 *   Optional properties multiply the API's grammar: 12 compile, 22 do not.
 * - **A nullable enum is `anyOf: [{ type: 'string', enum }, { type: 'null' }]`.**
 * - Kept small: at most `MAX_OPTIONAL` optional properties and `MAX_UNIONS`
 *   unions in one schema, measured below the API's own limits.
 *
 * No server dependency, so `node --test` can run it.
 */

export const MAX_OPTIONAL = 8;
export const MAX_UNIONS = 16;

export class ReplySchemaError extends Error {
  constructor(reader: string, problem: string) {
    super(`reply schema of ${reader}: ${problem}`);
    this.name = 'ReplySchemaError';
  }
}

type Node = Record<string, unknown>;

/** Every way the schema breaks the rules above; empty when it is fine. */
export function replySchemaProblems(schema: unknown): string[] {
  const problems: string[] = [];
  let optional = 0;
  let unions = 0;

  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as Node;

    if (Array.isArray(n['type'])) {
      unions += 1;
      if (Array.isArray(n['enum'])) {
        problems.push(`${path}: an enum with a type list; write anyOf [{ string, enum }, { null }]`);
      }
    }
    if (Array.isArray(n['anyOf'])) unions += 1;
    if (Array.isArray(n['enum']) && (n['enum'] as unknown[]).includes(null)) {
      problems.push(`${path}: null inside an enum; write anyOf [{ string, enum }, { null }]`);
    }

    const properties = n['properties'];
    if (properties !== null && typeof properties === 'object') {
      const required = new Set(Array.isArray(n['required']) ? (n['required'] as string[]) : []);
      for (const [key, child] of Object.entries(properties as Node)) {
        if (!required.has(key)) optional += 1;
        visit(child, `${path}.${key}`);
      }
      if (n['additionalProperties'] !== false) problems.push(`${path}: additionalProperties must be false`);
    }
    visit(n['items'], `${path}[]`);
    for (const key of ['anyOf', 'allOf']) {
      const list = n[key];
      if (Array.isArray(list)) list.forEach((child, i) => visit(child, `${path}.${key}[${i}]`));
    }
  };

  visit(schema, '$');
  if (optional > MAX_OPTIONAL) {
    problems.push(`${optional} optional properties (at most ${MAX_OPTIONAL}); make them required, "" when absent`);
  }
  if (unions > MAX_UNIONS) problems.push(`${unions} unions (at most ${MAX_UNIONS})`);
  return problems;
}

/** The schema itself, or `ReplySchemaError` before any request is sent. */
export function checkedSchema<T>(reader: string, schema: T): T {
  const problems = replySchemaProblems(schema);
  if (problems.length > 0) throw new ReplySchemaError(reader, problems.join('; '));
  return schema;
}
