/**
 * The timetable reader's prompt and reply schema — POOLSE-223.
 *
 * Its own module, free of `server-only`, so `pnpm timetable:eval` sends exactly
 * what the app sends. A change here is a change to the reader: it ships with a
 * recorded run of the corpus.
 */

export const SYSTEM = [
  'You read swimming-pool timetables (horários) published by clubs and municipal pools',
  'in Portugal, and return what they mean as rows. You see the rendered page: use merged',
  'cells, colours, headings and layout to understand it.',
  '',
  'Return one row per block of activity:',
  '- sourcePool: the pool or tank this block belongs to, as the document names it (a page',
  '  title, a column group, a heading such as "Piscina de 25 m"). Empty string when the',
  '  document names no pool.',
  '- weekday: 1 Monday … 7 Sunday.',
  '- start, end: HH:MM as printed. A block that spans several printed hours (a merged',
  '  cell, or the same activity continuing down consecutive rows as one block) is ONE row',
  '  from its first start to its last end. When only start times are printed, a block',
  '  ends where the next printed time begins.',
  '- activity: the activity name as printed, WITHOUT the lane count.',
  '  "Hidroginástica (3 pistas)" → activity "Hidroginástica", lanes 3.',
  '- lanes: the number of lanes when the document gives a count, else null. Never guess.',
  '- laneNames: lane names or ranges when the document names lanes ("Pista 2", "1-3"),',
  '  else an empty list. A count goes in lanes, never here.',
  '- closed: true for a block marked Encerrado, Fechado or closed. Its activity is "".',
  '',
  'A cell holding two activities is TWO rows with the same day and times, each with its',
  'own lane count: "Hidroginástica (3 pistas) / Natação Livre (3 pistas)" from 07:00 to',
  '08:00 on Monday is two rows, both Monday 07:00–08:00, lanes 3 each.',
  '',
  'Transcribe; never decide. Do not merge different activities, rename them, translate',
  'them, or drop a block you find odd. Keep accents and capitals.',
  '',
  'Ignore everything that is not a block of the weekly timetable: colour legends, page',
  'headers and footers, contact details, prices and tariff tables, opening-hours',
  'summaries, notes. They produce no row.',
  '',
  'validity: the period the timetable is in force, copied as printed (for example "em',
  'vigor de 14 de setembro a 30 de junho"), or an empty string when none is printed.',
].join('\n');

const NULLABLE_INT = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const;

export const SCHEMA = {
  type: 'object',
  properties: {
    validity: { type: 'string' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourcePool: { type: 'string' },
          weekday: { type: 'integer' },
          start: { type: 'string' },
          end: { type: 'string' },
          activity: { type: 'string' },
          // lanes may be null while laneNames is empty: otherwise the model invents counts.
          lanes: NULLABLE_INT,
          laneNames: { type: 'array', items: { type: 'string' } },
          closed: { type: 'boolean' },
        },
        required: ['sourcePool', 'weekday', 'start', 'end', 'activity', 'lanes', 'laneNames', 'closed'],
        additionalProperties: false,
      },
    },
  },
  required: ['validity', 'rows'],
  additionalProperties: false,
} as const;
