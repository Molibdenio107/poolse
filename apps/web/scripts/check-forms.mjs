import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Form fields are controlled — POOLSE-09 and POOLSE-10, and the form-debt sweep
 * of 15 October 2026.
 *
 * React 19 resets a form as soon as a function `action` returns, including when
 * it returns a validation error. A field on `defaultValue` therefore wipes what
 * somebody typed at the moment they are asked to correct it, and a `<select>`
 * on `defaultValue` springs back after a save that worked. The sweep converted
 * all 62 such fields; this keeps the count at zero, because the gates that
 * existed could not see it — typecheck is happy with both.
 *
 * Two shapes are refused, because the first sweep only looked for one:
 *
 * - **`defaultValue` / `defaultChecked` anywhere in code**, with or without an
 *   `=`. A bare `defaultChecked` is `defaultChecked={true}` and slipped past the
 *   old `\s*=` pattern.
 * - **A named `<input>`, `<select>` or `<textarea>` with neither `value=` nor
 *   `checked=`.** No default at all is just as uncontrolled, and is how a dozen
 *   fields survived the sweep. The element is read up to its own closing `>`,
 *   so a control written over several lines is judged whole. Hidden, file,
 *   submit and radio inputs are exempt: the first two are not typed into, a
 *   submit carries no state, and a radio group's state is its `checked`.
 *
 * The fix is `TextField` / `SelectField` / `TextAreaField`, or `useSeeded` from
 * `components/ui/field.tsx` for a hand-built control (and `useSuccessKey` for a
 * create form that should clear after each save). `field.tsx` itself is the one
 * file allowed to name the props, because it explains them.
 *
 * Run: pnpm forms:check
 */

const ROOT = fileURLToPath(new URL('../src', import.meta.url));
const ALLOWED = new Set(['components/ui/field.tsx']);
const DEFAULT_PROP = /\bdefault(Value|Checked)\b/;

/**
 * Named controls that are uncontrolled on purpose, by file and name.
 *
 * The pre-registration form's honeypot is empty and invisible by design — a
 * person never types into it, so there is nothing to keep, and wiring state to
 * it would only give a bot a React prop to read.
 */
const UNCONTROLLED_OK = new Map([
  ['app/(public)/inscricao/[slug]/registration-form.tsx', new Set(['website'])],
]);

const EXEMPT_TYPES = new Set(['hidden', 'file', 'submit', 'radio']);

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.name.endsWith('.tsx')) yield path;
  }
}

/**
 * The source with its comments blanked out, line breaks kept so positions
 * still map to line numbers. A comment may name the prop; only code is the
 * debt. `//` after a `:` is left alone, because that is a URL in a string.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before) => before + ' '.repeat(match.length - before.length));
}

/**
 * The text of a JSX element's opening tag, from `<` to the `>` that closes it.
 * An arrow inside a `{…}` attribute is not the end, so brace depth and string
 * literals are tracked.
 */
function openingTag(code, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return code.slice(start, i + 1);
  }
  return code.slice(start);
}

/** Attributes at the top level of the tag only — not inside a `{…}` value. */
function topLevel(tag) {
  let depth = 0;
  let out = '';
  for (const ch of tag) {
    if (ch === '}') depth -= 1;
    // The braces themselves stay, so `name={…}` still reads as a name.
    out += depth === 0 || (ch === '{' && depth === 0) ? ch : ch === '\n' ? '\n' : ' ';
    if (ch === '{') depth += 1;
  }
  return out;
}

const problems = [];
let scanned = 0;

for await (const path of files(ROOT)) {
  const rel = relative(ROOT, path).replaceAll('\\', '/');
  if (ALLOWED.has(rel)) continue;
  scanned += 1;
  const code = stripComments(await readFile(path, 'utf8'));
  const lines = code.split(/\r?\n/);
  const lineOf = (offset) => code.slice(0, offset).split('\n').length;

  lines.forEach((line, index) => {
    if (DEFAULT_PROP.test(line)) problems.push(`${rel}:${index + 1}: ${line.trim()}`);
  });

  const allowed = UNCONTROLLED_OK.get(rel) ?? new Set();
  for (const match of code.matchAll(/<(input|select|textarea)\b/g)) {
    const attrs = topLevel(openingTag(code, match.index));
    const name = /\bname=(?:"([^"]*)"|'([^']*)'|\{)/.exec(attrs);
    if (name === null) continue;
    const type = /\btype="([^"]*)"/.exec(attrs)?.[1];
    if (type !== undefined && EXEMPT_TYPES.has(type)) continue;
    if (/\b(value|checked)=/.test(attrs)) continue;
    const literal = name[1] ?? name[2];
    if (literal !== undefined && allowed.has(literal)) continue;
    problems.push(
      `${rel}:${lineOf(match.index)}: <${match[1]} name=${literal ?? '{…}'}> has no value or checked`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    `Uncontrolled form fields (${problems.length}) — use TextField/SelectField, or useSeeded from components/ui/field.tsx:\n` +
      problems.map((line) => `  ${line}`).join('\n'),
  );
  process.exit(1);
}

console.log(
  `All form fields are controlled: no defaultValue, defaultChecked or unbound named control in ${scanned} components.`,
);
