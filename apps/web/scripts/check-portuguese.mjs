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
  // A payment method's own name and a number — POOLSE-94.
  ['payTo.mbwayLine', 'MB WAY is the name of the service in both languages'],
  ['clubData.payment.iban', 'IBAN and MB WAY are the same names in both languages'],
  ['clubData.payment.mbwayTitle', 'IBAN and MB WAY are the same names in both languages'],
  ['payTo.mbway', 'IBAN and MB WAY are the same names in both languages'],
  ['app.name', 'the product is called Poolse in every language'],
  ['marketing.pricing.planName', 'the one plan is named after the product — POOLSE-60'],
  // A colour whose name is the same word in both languages, like "beige".
  // Renaming the pt-PT one to "fúcsia" purely to satisfy this check would be
  // choosing a different colour word to dodge a guard.
  ['classes.colours.magenta', 'the same colour name in both languages'],
  // A request's middle severity — POOLSE-66 slice 2b. "Normal" is the word in both.
  ['spaces.severity.normal', 'the same word in both languages'],
  ['health.api', 'an initialism'],
  // POOLSE-118: a key combination, printed as the keyboard prints it.
  ['palette.shortcut', 'key names are the same on both keyboards'],
  // POOLSE-116: the record's tab. "Feedback" is the word pt-PT uses ("dar feedback").
  ['feedback.tab', 'the same loanword in both languages'],
  ['sport.name.padel', 'the sport has one name in both languages'],
  ['account.email', '"email" is the ordinary pt-PT word too'],
  ['profile.email', 'as above'],
  ['publicWater.manage.link', '"link" is the ordinary pt-PT word too'],
  ['students.guardianEmail', 'as above'],
  // The Portuguese acronym for the tax number, and the one an English-speaking
  // operator of a Portuguese pool will also be looking at on the paperwork.
  // "Tax number" would be a translation of a form field nobody's form says.
  ['students.taxNumber', 'a Portuguese acronym, used as-is in both languages'],
  // The field names the import lists when it says what it will fill in.
  ['students.import.updateField.taxNumber', 'the same Portuguese acronym'],
  // POOLSE-69's public form: NIF is the acronym, and "Email" is the word the
  // Portuguese catalogue already uses ("Email de contacto").
  ['leads.public.swimmerTaxNumber', 'the same Portuguese acronym'],
  ['leads.public.email', 'the word the Portuguese catalogue already uses'],
  // POOLSE-72: a species is written in Latin in both languages.
  ['labResults.parameter.e_coli', 'a Latin species name'],
  ['labResults.parameter.pseudomonas_aeruginosa', 'a Latin species name'],
  ['students.import.updateField.contactEmail', '"email" is the ordinary pt-PT word too'],
  // A file-format name and its extension. "CSV" is not an English word being
  // left untranslated; it is what the format is called in every language.
  ['students.export.formatCsv', 'a file format and its extension'],
  // Sweep of 15-10-2026: the eleven the gate had been red on, every one the same
  // word in both languages on purpose, so a red gate meant nothing.
  ['export.pdf.option', 'a file format'],
  ['energy.cpe', 'the Portuguese code for a supply point, printed on every bill'],
  ['energy.invoice.cpe', 'as above'],
  ['energy.invoice.atcud', 'the Portuguese invoice code, printed as-is'],
  ['energy.invoice.registers.total', '"Total" is the same word in both languages'],
  ['invoices.total', 'as above'],
  ['energy.invoice.perKwh', 'a unit'],
  ['invoices.source.mbway', 'the name of a payment network'],
  ['invoices.channel.email', '"email" is the ordinary pt-PT word too'],
  ['reception.email', 'as above'],
  ['reception.taxNumber', 'the same Portuguese acronym'],
  ['activity.field.taxNumber', 'the same Portuguese acronym'],
  ['activity.system', 'the product is called Poolse in every language'],
  ['students.export.formatXlsx', 'a product name and its extension — Excel is Excel in Portuguese'],
  ['salaries.export.xlsx', 'a product name and its extension — Excel is Excel in Portuguese'],
  ['salaries.export.csv', 'a file format and its extension'],
  // The timetable export's button — POOLSE-54. Same reasoning as the register's
  // above: it names the application the file opens in, and that application is
  // called Excel in Lisbon too.
  ['grid.export.excel', 'a product name — Excel is Excel in Portuguese'],
  ['invite.email', 'as above'],
  ['invite.emailLabel', 'as above'],
  ['progress.minutes', '"min" is the abbreviation in both languages'],
  ['slots.minutes', 'the same abbreviation, on the schedule grid'],
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
  // POOLSE-85: the FPN's own name for an age group, which English keeps.
  ['qualifying.ageGroupNamePlaceholder', "the FPN's proper name for an age group"],
  // POOLSE-86: "Email" and Poolse's own name read the same in both languages.
  ['invoices.channel.poolse_email', 'a product name and a word both languages share'],
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

// -------------------------------------------------- Portuguese left in English
/*
 * The other direction, and nobody was checking it — POOLSE-R2-07.
 *
 * `turma` survived in twelve English strings: "Every turma has at least one
 * day", "No turmas at this frequency". The existing check only catches a key
 * that is *identical* in both files, and these were not — they were English
 * sentences with a Portuguese noun in them, which reads as a typo to an English
 * speaker and as a half-done translation to anyone else.
 *
 * The nav already calls this concept "class group", so the vocabulary existed;
 * what was missing was anything that noticed the two disagreeing.
 */
const PORTUGUESE_IN_ENGLISH = [
  ['turma', 'class group'],
  ['turmas', 'class groups'],
  ['parceria', 'partnership'],
  ['parcerias', 'partnerships'],
  ['escalão', 'level'],
  ['escalões', 'levels'],
  ['época', 'season'],
  ['reposição', 'make-up'],
  ['encerramento', 'closure'],
  ['lotação', 'capacity'],
];

for (const [key, value] of Object.entries(en)) {
  // `{turma}` is a placeholder name — code, not prose — and renaming one would
  // break the call site that passes it.
  const prose = value.replace(/\{[a-zA-Z0-9_]+/g, '{');
  for (const [portuguese, english] of PORTUGUESE_IN_ENGLISH) {
    if (new RegExp(String.raw`\b${portuguese}\b`, 'i').test(prose)) {
      problems.push(
        `${key}
    Portuguese "${portuguese}" in an English string — say "${english}"
    ${value}`,
      );
    }
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
console.log(
  `en reads as English across ${Object.keys(en).length} keys: no Portuguese nouns left in it.`,
);
console.log('This checks spelling and vocabulary. Tone and register still want a person.');
