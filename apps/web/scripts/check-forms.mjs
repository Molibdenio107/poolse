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
 * The fix is `TextField` / `SelectField` / `TextAreaField`, or `useSeeded` from
 * `components/ui/field.tsx` for a hand-built control (and `useSuccessKey` for a
 * create form that should clear after each save). `field.tsx` itself is the one
 * file allowed to name the props, because it explains them.
 *
 * Run: pnpm forms:check
 */

const ROOT = fileURLToPath(new URL('../src', import.meta.url));
const ALLOWED = new Set(['components/ui/field.tsx']);
const PATTERN = /\bdefault(Value|Checked)\s*=/g;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.name.endsWith('.tsx')) yield path;
  }
}

const problems = [];
let scanned = 0;

for await (const path of files(ROOT)) {
  const rel = relative(ROOT, path).replaceAll('\\', '/');
  if (ALLOWED.has(rel)) continue;
  scanned += 1;
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  lines.forEach((line, index) => {
    // A comment may name the prop; only code is the debt.
    const code = line.replace(/\/\/.*$/, '').trim();
    if (code.startsWith('*') || code.startsWith('/*')) return;
    if (PATTERN.test(code)) problems.push(`${rel}:${index + 1}: ${code}`);
    PATTERN.lastIndex = 0;
  });
}

if (problems.length > 0) {
  console.error(
    `Uncontrolled form fields (${problems.length}) — use TextField/SelectField, or useSeeded from components/ui/field.tsx:\n` +
      problems.map((line) => `  ${line}`).join('\n'),
  );
  process.exit(1);
}

console.log(`All form fields are controlled: no defaultValue or defaultChecked in ${scanned} components.`);
