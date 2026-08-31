/**
 * European Portuguese, checked mechanically.
 *
 * `i18n:check` proves every key exists in both files. It cannot tell you the
 * Portuguese is the *right* Portuguese, and CLAUDE.md says so explicitly — that
 * part is read by a person.
 *
 * This does the half a person is bad at: scanning 900 strings for the handful of
 * Brazilian forms that slip in, and for English that never got translated. It
 * does not judge tone, register or whether a sentence is worth saying. Those
 * still want eyes.
 *
 * Run: pnpm --filter @poolse/web pt:check
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MESSAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'messages');

/** The pairs CLAUDE.md names, plus a few of the same family. */
const BRAZILIAN = [
  ['usuário', 'utilizador'],
  ['usuario', 'utilizador'],
  ['seção', 'secção'],
  ['arquivo', 'ficheiro'],
  ['arquivos', 'ficheiros'],
  ['salvar', 'guardar'],
  ['tela', 'ecrã'],
  ['cadastro', 'registo'],
  ['cadastrar', 'registar'],
  ['senha', 'palavra-passe'],
  ['esporte', 'desporto'],
  ['bilhão', 'mil milhões'],
  ['celular', 'telemóvel'],
  ['ônibus', 'autocarro'],
  ['trem', 'comboio'],
  ['fila', 'bicha'],
];

/**
 * Strings that are legitimately the same in both locales.
 *
 * Each one is a decision rather than an oversight, so each is listed with the
 * reason. A new entry here should be arguable out loud; if it is not, the string
 * probably needs translating.
 */
const SAME_ON_PURPOSE = new Map([
  ['app.name', 'the product is called Poolse in every language'],
  ['health.api', 'an initialism'],
  ['account.email', '"email" is the ordinary pt-PT word too'],
  ['profile.email', 'as above'],
  ['students.guardianEmail', 'as above'],
  // The Portuguese acronym for the tax number, and the one an English-speaking
  // operator of a Portuguese pool will also be looking at on the paperwork.
  // "Tax number" would be a translation of a form field nobody's form says.
  ['students.taxNumber', 'a Portuguese acronym, used as-is in both languages'],
  // The field names the import lists when it says what it will fill in.
  ['students.import.updateField.taxNumber', 'the same Portuguese acronym'],
  ['students.import.updateField.contactEmail', '"email" is the ordinary pt-PT word too'],
  // A file-format name and its extension. "CSV" is not an English word being
  // left untranslated; it is what the format is called in every language.
  ['students.export.formatCsv', 'a file format and its extension'],
  ['students.export.formatXlsx', 'a product name and its extension — Excel is Excel in Portuguese'],
  ['invite.email', 'as above'],
  ['invite.emailLabel', 'as above'],
  ['progress.minutes', '"min" is the abbreviation in both languages'],
  ['staff.title', 'POOLSE-38 decided: "Staff" is the word Portuguese clubs use, and "Pessoal" is a translation nobody says'],
  ['facilities.volume', 'a unit — "{litres} L"'],
  ['facilities.size', 'a unit — "{size} m"'],
  ['classes.minutes', 'a unit — "{count} min"'],
  ['skills.noVideo', 'an em dash'],
  ['advancement.fromTo', 'an arrow between two interpolated level names'],
  ['calendar.clashRow', 'two interpolated names and a time'],
  // The nine water-quality units. These are symbols, not words: ppm, NTU, °C and
  // pH are written the same in Portuguese as in English, and "translating" one
  // would put a unit on a compliance report that no laboratory uses.
  ['facilities.unit.ph', 'a unit symbol'],
  ['facilities.unit.temperature', 'a unit symbol'],
  ['facilities.unit.free_chlorine', 'a unit symbol — ppm'],
  ['facilities.unit.combined_chlorine', 'a unit symbol — ppm'],
  ['facilities.unit.total_alkalinity', 'a unit symbol — ppm'],
  ['facilities.unit.calcium_hardness', 'a unit symbol — ppm'],
  ['facilities.unit.cyanuric_acid', 'a unit symbol — ppm'],
  ['facilities.unit.turbidity', 'a unit symbol — NTU'],
  ['facilities.unit.salt', 'a unit symbol — ppm'],
  ['facilities.metric.ph', 'pH is written the same in both languages'],
]);

function flatten(object, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') Object.assign(out, flatten(value, path));
    else out[path] = String(value);
  }
  return out;
}

/**
 * The literal words in an ICU string — everything outside every brace.
 *
 * Brace-counted rather than regex-stripped, because ICU plurals nest:
 * `{n, plural, one {# aluno} other {# alunos}}` has braces inside braces, and a
 * non-greedy `\{[^}]*\}` mangles it into something that compares equal to the
 * English by accident. That produced thirty false positives on the first run.
 */
function literals(text) {
  let depth = 0;
  let out = '';
  for (const character of text) {
    if (character === '{') depth += 1;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += character;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * The words inside ICU plural branches, which are real translated text too.
 *
 * `{n, plural, one {# aluno} other {# alunos}}` is entirely inside braces, so
 * `literals` sees nothing — and "aluno" is exactly the sort of word that would
 * be left in English. Depth 2 and deeper is where the branch bodies live.
 */
function branchText(text) {
  let depth = 0;
  let out = '';
  for (const character of text) {
    if (character === '{') { depth += 1; continue; }
    if (character === '}') { depth = Math.max(0, depth - 1); continue; }
    if (depth >= 2) out += character;
  }
  return out.replace(/[#\s]+/g, ' ').trim();
}

const pt = flatten(JSON.parse(await readFile(join(MESSAGES, 'pt-PT.json'), 'utf8')));
const en = flatten(JSON.parse(await readFile(join(MESSAGES, 'en.json'), 'utf8')));

const problems = [];

// ---------------------------------------------------------------- Brazilian
for (const [key, value] of Object.entries(pt)) {
  // Placeholder names are code, not prose: `{time}` is not the word "time".
  const prose = value.replace(/\{[a-zA-Z0-9_]+\b/g, '{');
  for (const [brazilian, european] of BRAZILIAN) {
    if (new RegExp(`\\b${brazilian}\\b`, 'i').test(prose)) {
      problems.push(`${key}\n    Brazilian "${brazilian}" — pt-PT uses "${european}"\n    ${value}`);
    }
  }
}

// "está processando" rather than "está a processar" — the tense CLAUDE.md names.
for (const [key, value] of Object.entries(pt)) {
  const match = value.match(/\b(est(á|ão|ou|amos))\s+(\w+ndo)\b/i);
  if (match) {
    problems.push(
      `${key}\n    Brazilian present continuous "${match[0]}" — pt-PT says "está a ${match[3].replace(/ndo$/, 'r')}"\n    ${value}`,
    );
  }
}

// ---------------------------------------------------------------- untranslated
for (const [key, value] of Object.entries(pt)) {
  if (SAME_ON_PURPOSE.has(key) || !(key in en)) continue;

  const ptText = `${literals(value)} ${branchText(value)}`.trim();
  const enText = `${literals(en[key])} ${branchText(en[key])}`.trim();

  // Nothing but placeholders and punctuation: there is no prose to translate.
  if (!/[a-zà-ÿ]{3}/i.test(ptText)) continue;

  if (ptText.toLowerCase() === enText.toLowerCase()) {
    problems.push(`${key}\n    identical in both locales — English left untranslated?\n    ${value}`);
  }
}

if (problems.length > 0) {
  console.log(`${problems.length} thing(s) to look at:\n`);
  for (const problem of problems) console.log(`  ${problem}\n`);
  process.exit(1);
}

console.log(
  `pt-PT reads as European Portuguese across ${Object.keys(pt).length} keys: ` +
    'no Brazilian forms, no Brazilian present continuous, nothing left in English.',
);
console.log('This checks spelling and vocabulary. Tone and register still want a person.');
