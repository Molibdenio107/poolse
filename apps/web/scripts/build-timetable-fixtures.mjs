// The timetable reader's test corpus, built — POOLSE-223.
//
// Every case is fictional and generated here, so the corpus carries no club's
// real document and can be rebuilt after a change to a case. Each case is data:
// the same data renders the document (HTML printed to PDF, or screenshotted to a
// JPEG) and writes `expected.json`, the rows of meaning the reader must return.
//
// Run: node apps/web/scripts/build-timetable-fixtures.mjs   (no model call, free)

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'test-fixtures', 'timetables');

const DAYS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const clock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const at = (text) => {
  const [h, m] = text.split(':');
  return Number(h) * 60 + Number(m);
};
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/*
 * A grid pool: days across, hourly slots down, blocks spanning slots. A block is
 * `[weekday, firstSlot, span, items]` where items is 'closed' or a list of
 * `[activity, laneCount | null, laneNames?]`. A pool named '' prints no heading
 * and reads as no source pool; `closedWord` is how the sheet says closed.
 */
function gridRows(pool) {
  const rows = [];
  for (const [weekday, slot, span, items] of pool.blocks) {
    const start = clock(at(pool.from) + slot * pool.step);
    const end = clock(at(pool.from) + (slot + span) * pool.step);
    if (items === 'closed') {
      rows.push({ sourcePool: pool.name, weekday, start, end, activity: '', lanes: null, laneNames: [], closed: true });
      continue;
    }
    for (const [activity, lanes, laneNames = []] of items) {
      rows.push({ sourcePool: pool.name, weekday, start, end, activity, lanes, laneNames, closed: false });
    }
  }
  return rows;
}

function gridHtml(pool, colours) {
  const days = [...new Set(pool.blocks.map((block) => block[0]))].sort();
  const slots = pool.slots;
  const taken = new Set();
  const byStart = new Map(pool.blocks.map((block) => [`${block[0]}:${block[1]}`, block]));
  let body = '';
  for (let slot = 0; slot < slots; slot += 1) {
    const from = clock(at(pool.from) + slot * pool.step);
    const to = clock(at(pool.from) + (slot + 1) * pool.step);
    body += `<tr><th class="time">${from} - ${to}</th>`;
    for (const day of days) {
      if (taken.has(`${day}:${slot}`)) continue;
      const block = byStart.get(`${day}:${slot}`);
      if (block === undefined) {
        body += '<td></td>';
        continue;
      }
      const [, , span, items] = block;
      for (let k = 1; k < span; k += 1) taken.add(`${day}:${slot + k}`);
      const label =
        items === 'closed'
          ? (pool.closedWord ?? 'Encerrado')
          : items
              .map(([name, lanes, laneNames = []]) =>
                laneNames.length > 0
                  ? `${escape(name)}<br><small>Pistas ${laneNames.join(', ')}</small>`
                  : lanes === null
                    ? escape(name)
                    : `${escape(name)} (${lanes} pistas)`,
              )
              .join('<br>/<br>');
      const key = items === 'closed' ? 'Encerrado' : items[0][0];
      body += `<td rowspan="${span}" style="background:${colours[key] ?? '#fff'}">${label}</td>`;
    }
    body += '</tr>';
  }
  return `${pool.name === '' ? '' : `<h2>${escape(pool.name)}</h2>`}
<table class="grid"><thead><tr><th></th>${days.map((day) => `<th>${DAYS[day]}</th>`).join('')}</tr></thead>
<tbody>${body}</tbody></table>`;
}

const STYLE = `
body { font-family: Arial, sans-serif; font-size: 11px; margin: 24px; }
h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 12px 0 6px; }
table.grid { border-collapse: collapse; width: 100%; }
table.grid th, table.grid td { border: 1px solid #555; padding: 4px; text-align: center; vertical-align: middle; }
th.time { white-space: nowrap; width: 90px; }
.legend { margin-top: 10px; display: flex; gap: 12px; flex-wrap: wrap; }
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.legend i { width: 14px; height: 10px; display: inline-block; border: 1px solid #555; }
.footer { margin-top: 16px; font-size: 9px; color: #444; border-top: 1px solid #999; padding-top: 4px; }
.page { page-break-after: always; }
table.prices { border-collapse: collapse; } table.prices td, table.prices th { border: 1px solid #555; padding: 4px 10px; }
`;

function legend(colours) {
  return `<div class="legend">${Object.entries(colours)
    .map(([name, colour]) => `<span><i style="background:${colour}"></i>${escape(name)}</span>`)
    .join('')}</div>`;
}

/* ------------------------------------------------------------------------- */
/* Case 1 — two pools, spans, two-activity cells, Encerrado, a tariff page.   */
/* Shaped after the first real timetable that broke the grid reader.          */
/* ------------------------------------------------------------------------- */

const HN = [['Hidroginástica', 3], ['Natação Livre', 3]];
const monteAlvoMain = {
  name: 'Piscina de 25 m',
  from: '07:00',
  step: 60,
  slots: 7,
  blocks: [
    [1, 0, 1, HN], [1, 1, 1, [['Escola de Natação', null]]], [1, 2, 1, [['Escolas (curricular)', null]]],
    [1, 3, 3, [['Natação Livre', 6]]], [1, 6, 1, 'closed'],
    [2, 0, 2, [['Clube – Treino', null]]], [2, 2, 1, HN], [2, 3, 2, [['Escola de Natação', null]]],
    [2, 5, 2, [['Natação Livre', 6]]],
    [3, 0, 1, HN], [3, 1, 1, [['Escola de Natação', null]]], [3, 2, 1, [['Escolas (curricular)', null]]],
    [3, 3, 3, [['Natação Livre', 6]]], [3, 6, 1, 'closed'],
    [4, 0, 2, [['Clube – Treino', null]]], [4, 2, 1, HN], [4, 3, 2, [['Escola de Natação', null]]],
    [4, 5, 2, [['Natação Livre', 6]]],
    [5, 0, 1, HN], [5, 1, 5, [['Natação Livre', 6]]], [5, 6, 1, 'closed'],
    [6, 0, 2, 'closed'], [6, 2, 2, [['Escola de Natação', null]]], [6, 4, 3, [['Natação Livre', 6]]],
  ],
};
const monteAlvoLearner = {
  name: 'Piscina de Aprendizagem',
  from: '07:00',
  step: 60,
  slots: 7,
  blocks: [
    [1, 0, 2, 'closed'], [1, 2, 1, [['Bebés', null]]], [1, 3, 2, [['Escola de Natação', null]]],
    [1, 5, 1, [['Hidroterapia', null]]], [1, 6, 1, 'closed'],
    [2, 0, 3, 'closed'], [2, 3, 2, [['Escolas (curricular)', null]]], [2, 5, 2, [['Natação Adaptada', null]]],
    [3, 0, 2, 'closed'], [3, 2, 1, [['Bebés', null]]], [3, 3, 2, [['Escola de Natação', null]]],
    [3, 5, 1, [['Hidroterapia', null]]], [3, 6, 1, 'closed'],
    [4, 0, 3, 'closed'], [4, 3, 2, [['Escolas (curricular)', null]]], [4, 5, 2, [['Natação Adaptada', null]]],
    [5, 0, 7, 'closed'],
    [6, 0, 2, 'closed'], [6, 2, 2, [['Bebés', null]]], [6, 4, 3, [['Escola de Natação', null]]],
  ],
};
const monteAlvoColours = {
  'Natação Livre': '#cfe8f3', 'Hidroginástica': '#cfe8f3', 'Escola de Natação': '#fde8b0',
  'Escolas (curricular)': '#e3d4f0', 'Clube – Treino': '#d6efd0', 'Bebés': '#fbd3d3',
  'Hidroterapia': '#e8e8e8', 'Natação Adaptada': '#e8e8e8', 'Encerrado': '#9a9a9a',
};
const monteAlvoHeader = `<h1>Piscinas Municipais de Monte Alvo — Horário 2026/2027</h1>
<p>Em vigor de 14 de setembro de 2026 a 30 de junho de 2027</p>`;
const monteAlvoFooter = `<div class="footer">Câmara Municipal de Monte Alvo · Divisão de Desporto · Rua da Fonte Fictícia, 12 · Tel. 200 000 000 · Horário sujeito a alterações.</div>`;

const CASES = [
  {
    name: '01-monte-alvo-two-pools',
    kind: 'pdf',
    html: `<div class="page">${monteAlvoHeader}${gridHtml(monteAlvoMain, monteAlvoColours)}${legend(monteAlvoColours)}${monteAlvoFooter}</div>
<div class="page">${monteAlvoHeader}${gridHtml(monteAlvoLearner, monteAlvoColours)}${legend(monteAlvoColours)}${monteAlvoFooter}</div>
<div>${monteAlvoHeader}<h2>Tarifário e horário de funcionamento</h2>
<table class="prices"><tr><th>Utilização</th><th>Preço</th></tr>
<tr><td>Natação Livre — entrada única</td><td>3,20 €</td></tr><tr><td>Natação Livre — 10 entradas</td><td>27,00 €</td></tr>
<tr><td>Hidroginástica — mensalidade (2x/semana)</td><td>32,50 €</td></tr><tr><td>Escola de Natação — mensalidade</td><td>29,00 €</td></tr></table>
<h2>Horário de funcionamento</h2><table class="prices"><tr><td>Segunda a sexta</td><td>07:00 - 14:00</td></tr><tr><td>Sábado</td><td>07:00 - 14:00</td></tr><tr><td>Domingo e feriados</td><td>Encerrado</td></tr></table>
${monteAlvoFooter}</div>`,
    expected: {
      validity: 'Em vigor de 14 de setembro de 2026 a 30 de junho de 2027',
      rows: [...gridRows(monteAlvoMain), ...gridRows(monteAlvoLearner)],
    },
  },
];

/* ------------------------------------------------------------------------- */
/* Cases 2–6 — the other shapes a club's timetable arrives in.               */
/* ------------------------------------------------------------------------- */

const r = (sourcePool, weekday, start, end, activity, lanes = null, laneNames = []) => ({
  sourcePool, weekday, start, end, activity, lanes, laneNames, closed: false,
});
const shut = (sourcePool, weekday, start, end) => ({
  sourcePool, weekday, start, end, activity: '', lanes: null, laneNames: [], closed: true,
});

/** A list: one line per block, as an office keeps it in Word or Excel. */
function listHtml(rows, closedWord) {
  const sorted = [...rows].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  return `<table class="grid"><thead><tr><th>Dia</th><th>Horário</th><th>Piscina</th><th>Atividade</th><th>N.º de pistas</th></tr></thead><tbody>${sorted
    .map(
      (row) =>
        `<tr><td>${DAYS[row.weekday]}</td><td>${row.start} às ${row.end}</td><td>${escape(row.sourcePool)}</td><td>${
          row.closed ? closedWord : escape(row.activity)
        }</td><td>${row.lanes ?? '—'}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

/** Days as columns, each a stack of time ranges — no time axis at all. */
function columnsHtml(rows) {
  const days = [...new Set(rows.map((row) => row.weekday))].sort();
  const cell = (weekday) =>
    rows
      .filter((row) => row.weekday === weekday)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(
        (row) =>
          `<div class="entry"><b>${row.start}–${row.end}</b><br>${
            row.closed ? 'Fechado' : `${escape(row.activity)}${row.lanes === null ? '' : ` (${row.lanes} pistas)`}`
          }</div>`,
      )
      .join('');
  return `<table class="grid cols"><thead><tr>${days.map((day) => `<th>${DAYS[day]}</th>`).join('')}</tr></thead>
<tbody><tr>${days.map((day) => `<td>${cell(day)}</td>`).join('')}</tr></tbody></table>`;
}

// Case 2: one pool, 30-minute rows, lanes named rather than counted, "Fechado".
const naval = {
  name: '',
  from: '17:00',
  step: 30,
  slots: 8,
  closedWord: 'Fechado',
  blocks: [
    [1, 0, 2, [['Cadetes', null, ['1-3']], ['Infantis', null, ['4-6']]]],
    [1, 2, 2, [['Juvenis', null, ['1-6']]]],
    [1, 4, 3, [['Masters', null, ['1-2']], ['Hidroginástica', null, ['3-6']]]],
    [1, 7, 1, 'closed'],
    [2, 0, 2, [['Pré-competição', null, ['1-2']]]],
    [2, 2, 4, [['Absolutos', null, ['1-6']]]],
    [2, 6, 2, [['Masters', null, ['1-3']]]],
    [3, 0, 2, [['Cadetes', null, ['1-3']], ['Infantis', null, ['4-6']]]],
    [3, 2, 2, [['Juvenis', null, ['1-6']]]],
    [3, 4, 3, [['Masters', null, ['1-2']], ['Hidroginástica', null, ['3-6']]]],
    [3, 7, 1, 'closed'],
    [4, 0, 2, [['Pré-competição', null, ['1-2']]]],
    [4, 2, 4, [['Absolutos', null, ['1-6']]]],
    [4, 6, 2, [['Masters', null, ['1-3']]]],
    [5, 0, 4, [['Natação Livre', null, ['1-6']]]],
    [5, 4, 4, 'closed'],
  ],
};
const navalColours = { Cadetes: '#fde8b0', Infantis: '#fde8b0', Juvenis: '#d6efd0', Masters: '#cfe8f3', 'Hidroginástica': '#e3d4f0', 'Pré-competição': '#fbd3d3', Absolutos: '#d6efd0', 'Natação Livre': '#cfe8f3', Fechado: '#9a9a9a' };

// Case 3: a list across two tanks, with a lane-count column.
const listRows = [
  r('Tanque A', 1, '07:30', '08:30', 'Natação Livre', 4),
  r('Tanque A', 1, '18:00', '18:45', 'Hidroginástica', 2),
  r('Tanque A', 1, '18:00', '18:45', 'Natação Livre', 2),
  r('Tanque B', 1, '17:30', '18:15', 'Bebés'),
  r('Tanque B', 1, '18:15', '19:00', 'Adaptação ao Meio Aquático'),
  r('Tanque A', 2, '07:30', '08:30', 'Natação Livre', 4),
  r('Tanque A', 2, '19:00', '20:30', 'Treino Masters', 4),
  r('Tanque B', 2, '17:30', '18:15', 'Natação Grávidas'),
  shut('Tanque B', 3, '09:00', '13:00'),
  r('Tanque A', 3, '18:00', '18:45', 'Hidroginástica', 2),
  r('Tanque A', 3, '18:00', '18:45', 'Natação Livre', 2),
  r('Tanque B', 3, '17:30', '18:15', 'Bebés'),
  r('Tanque A', 4, '19:00', '20:30', 'Treino Masters', 4),
  r('Tanque A', 6, '09:00', '12:00', 'Natação Livre', 4),
  r('Tanque B', 6, '10:00', '11:00', 'Natação para Seniores'),
];

// Case 4: days as columns of time ranges, one pool named in the title.
const colRows = [
  r('Piscina Coberta', 1, '07:00', '09:00', 'Natação Livre', 5),
  r('Piscina Coberta', 1, '12:30', '14:00', 'Natação Livre', 3),
  r('Piscina Coberta', 1, '18:30', '19:15', 'Hidroginástica'),
  r('Piscina Coberta', 2, '07:00', '09:00', 'Natação Livre', 5),
  r('Piscina Coberta', 2, '17:45', '18:30', 'Escola de Natação — Nível 1'),
  r('Piscina Coberta', 2, '18:30', '19:15', 'Escola de Natação — Nível 2'),
  r('Piscina Coberta', 3, '07:00', '09:00', 'Natação Livre', 5),
  r('Piscina Coberta', 3, '18:30', '19:15', 'Hidroginástica'),
  shut('Piscina Coberta', 3, '12:30', '14:00'),
  r('Piscina Coberta', 4, '17:45', '18:30', 'Escola de Natação — Nível 1'),
  r('Piscina Coberta', 4, '18:30', '19:15', 'Escola de Natação — Nível 2'),
  r('Piscina Coberta', 5, '07:00', '09:00', 'Natação Livre', 5),
  r('Piscina Coberta', 5, '20:00', '21:00', 'Aquafitness', 2),
  r('Piscina Coberta', 6, '09:00', '13:00', 'Natação Livre', 5),
];

// Case 5: a wall sheet, photographed — tilted, warm paper, JPEG noise.
const wall = {
  name: '',
  from: '08:00',
  step: 60,
  slots: 5,
  blocks: [
    [1, 0, 2, [['Natação Livre', 4]]], [1, 2, 1, [['Hidroginástica', 2], ['Natação Livre', 2]]], [1, 3, 2, 'closed'],
    [2, 0, 1, [['Bebés', null]]], [2, 1, 4, [['Natação Livre', 4]]],
    [3, 0, 2, [['Natação Livre', 4]]], [3, 2, 1, [['Hidroginástica', 2], ['Natação Livre', 2]]], [3, 3, 2, 'closed'],
    [4, 0, 1, [['Bebés', null]]], [4, 1, 4, [['Natação Livre', 4]]],
    [6, 0, 3, [['Escola de Natação', null]]], [6, 3, 2, [['Natação Livre', 4]]],
  ],
};
const wallColours = { 'Natação Livre': '#d9ecf5', 'Hidroginástica': '#efe1f7', 'Bebés': '#fde0e0', 'Escola de Natação': '#fdf0c4', Encerrado: '#b5b5b5' };

// Case 6: a Word document — a legend and notes ABOVE the grid, one pool named.
const olimpica = {
  name: 'Piscina Olímpica',
  from: '18:00',
  step: 60,
  slots: 3,
  blocks: [
    [1, 0, 1, [['Hidroginástica', 3], ['Natação Livre', 5]]], [1, 1, 2, [['Treino de Competição', 8]]],
    [2, 0, 3, [['Natação Livre', 8]]],
    [3, 0, 1, [['Hidroginástica', 3], ['Natação Livre', 5]]], [3, 1, 2, [['Treino de Competição', 8]]],
    [4, 0, 2, [['Polo Aquático', 8]]], [4, 2, 1, 'closed'],
    [5, 0, 3, [['Natação Livre', 8]]],
  ],
};
const olimpicaColours = { 'Natação Livre': '#cfe8f3', 'Hidroginástica': '#e3d4f0', 'Treino de Competição': '#d6efd0', 'Polo Aquático': '#fde8b0', Encerrado: '#9a9a9a' };

CASES.push(
  {
    name: '02-one-pool-lane-names',
    kind: 'pdf',
    html: `<h1>Clube Naval de Vila Fictícia — Horário de Inverno</h1><p>Secção de Natação · Época 2026/2027</p>${gridHtml(naval, navalColours)}${legend(navalColours)}
<div class="footer">As pistas indicadas são as da piscina de 25 m. Contactos: secretaria@exemplo.test</div>`,
    expected: { validity: null, rows: gridRows(naval) },
  },
  {
    name: '03-list-layout',
    kind: 'pdf',
    html: `<h1>Complexo Desportivo da Ribeira Fictícia</h1><p>Distribuição semanal das piscinas — válido a partir de 5 de outubro de 2026</p>${listHtml(listRows, 'Encerrado (manutenção)')}
<p style="margin-top:12px">Inscrições na receção. Os horários de Natação Livre podem ser reduzidos em dias de competição.</p>`,
    expected: { validity: 'válido a partir de 5 de outubro de 2026', rows: listRows },
  },
  {
    name: '04-days-as-columns',
    kind: 'pdf',
    html: `<style>table.cols td { vertical-align: top; } .entry { margin: 4px 0 10px; text-align: left; }</style>
<h1>Piscina Coberta Municipal de Serra Fictícia</h1><p>Horário de utilização</p>${columnsHtml(colRows)}
<div class="footer">Domingo: encerrado. Feriados: consultar avisos.</div>`,
    expected: { validity: null, rows: colRows },
  },
  {
    name: '05-wall-photo',
    kind: 'jpg',
    html: `<style>body { background: #8a8378; } .sheet { background: #f4efe2; padding: 28px; margin: 30px; transform: rotate(-2.2deg); box-shadow: 6px 8px 18px rgba(0,0,0,.5); filter: contrast(.92) blur(.35px); font-family: 'Comic Sans MS', cursive; }</style>
<div class="sheet"><h1>HORÁRIO DA PISCINA</h1>${gridHtml(wall, wallColours)}<p>Qualquer dúvida fale com o nadador-salvador.</p></div>`,
    expected: { validity: null, rows: gridRows(wall) },
  },
  {
    name: '06-word-legend-above',
    kind: 'pdf',
    html: `<style>body { font-family: Calibri, 'Segoe UI', sans-serif; }</style>
<h1>Associação Desportiva Fictícia — Ocupação da Piscina Olímpica</h1>
<p><b>Legenda</b></p>${legend(olimpicaColours)}
<ul style="margin-top:8px"><li>* As aulas de Hidroginástica requerem inscrição prévia.</li><li>A Natação Livre pode ser suspensa em dia de prova.</li><li>Preço: 3,00 € por entrada.</li></ul>
${gridHtml(olimpica, olimpicaColours)}
<p style="margin-top:10px;font-size:9px">Documento gerado em 02-10-2026 · Página 1 de 1</p>`,
    expected: { validity: null, rows: gridRows(olimpica) },
  },
);

const browser = await chromium.launch();
try {
  for (const entry of CASES) {
    const folder = join(root, entry.name);
    mkdirSync(folder, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    await page.setContent(`<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${entry.html}</body></html>`);
    if (entry.kind === 'pdf') {
      await page.pdf({ path: join(folder, 'timetable.pdf'), format: 'A4', landscape: true, printBackground: true });
    } else {
      await page.screenshot({ path: join(folder, 'timetable.jpg'), type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: 1100, height: 380 } });
    }
    await page.close();
    writeFileSync(join(folder, 'expected.json'), `${JSON.stringify(entry.expected, null, 2)}\n`);
    console.log(`${entry.name}: ${entry.expected.rows.length} rows (${entry.expected.rows.filter((row) => row.closed).length} closed)`);
  }
} finally {
  await browser.close();
}
