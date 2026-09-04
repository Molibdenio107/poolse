// The `.ts` on the specifier is not a slip: this module is reached by
// `node --test`, whose resolver does not add extensions. `inventory-sheet.ts`
// carries one for the same reason.
import { matchFields, type MatchResult, type MatchSpec, type Sheet } from './sheet.ts';

/**
 * The timetable's field vocabulary — POOLSE-54.
 *
 * The third sibling of `sheet.ts`, after the register's and the inventory's, and
 * built for the same reason: **what the export writes, an importer reads.** The
 * `Marcações` sheet's header row is these labels out of the catalogue, so a club
 * that plans next season in Excel can bring the file back without pointing a
 * single column at a field by hand.
 *
 * There is no booking importer yet — that is a later ticket. The vocabulary
 * comes first anyway, because the alternative is a header row of prose invented
 * for the file, which then has to be either matched by an importer written
 * around it or quietly changed later, breaking every file a club has already
 * saved. Writing the contract now costs one module; retrofitting it costs the
 * files people already have.
 *
 * The order is the order of the columns, and it is deliberate: what, when,
 * where, who, how many. It reads left to right the way somebody describes a
 * class out loud.
 */
export const BOOKING_FIELDS = [
  'subject',
  'name',
  'partner',
  'weekday',
  'startTime',
  'endTime',
  'durationMinutes',
  'pool',
  'lanes',
  'instructor',
  'instructorStatus',
  'headcount',
  'category',
  'level',
  'notes',
] as const;

export type BookingField = (typeof BOOKING_FIELDS)[number];

export type BookingMapping = Record<BookingField, number | null>;

export const EMPTY_BOOKING_MAPPING: BookingMapping = {
  subject: null,
  name: null,
  partner: null,
  weekday: null,
  startTime: null,
  endTime: null,
  durationMinutes: null,
  pool: null,
  lanes: null,
  instructor: null,
  instructorStatus: null,
  headcount: null,
  category: null,
  level: null,
  notes: null,
};

/**
 * The header words each field answers to, in pt-PT and en.
 *
 * **The three time columns are the trap.** "Hora", "Início", "Fim" and "Duração"
 * are four words for one idea, and a club's own sheet uses whichever two it
 * feels like. They are separated here by their full names rather than by their
 * short ones, and `startTime` deliberately claims the bare "Hora": a sheet with
 * one time column means the time it starts, every time.
 *
 * "Pista" and "Tanque" are likewise a pair that reads as one thing to anybody
 * who has not built a pool schema — a lane and the tank it is in. Both are
 * listed, and neither answers to the other's words.
 */
const SYNONYMS: [BookingField, string[]][] = [
  ['subject', ['tipo', 'tipo de marcacao', 'tipo de marcação', 'genero', 'kind', 'type']],
  ['name', ['nome', 'turma', 'grupo', 'designacao', 'designação', 'name', 'group', 'class']],
  ['partner', ['parceria', 'parceiro', 'entidade', 'escola', 'partner', 'organisation', 'organization']],
  ['weekday', ['dia', 'dia da semana', 'weekday', 'day', 'day of week']],
  ['startTime', ['hora', 'inicio', 'início', 'hora de inicio', 'hora de início', 'comeca', 'começa', 'start', 'start time', 'from']],
  ['endTime', ['fim', 'hora de fim', 'termina', 'ate', 'até', 'end', 'end time', 'to', 'until']],
  ['durationMinutes', ['duracao', 'duração', 'minutos', 'duration', 'minutes', 'length']],
  ['pool', ['tanque', 'piscina', 'pool', 'tank']],
  ['lanes', ['pistas', 'pista', 'lanes', 'lane']],
  ['instructor', ['professor', 'professora', 'treinador', 'monitor', 'instrutor', 'instructor', 'coach', 'teacher']],
  ['instructorStatus', ['estado do professor', 'estado', 'situacao', 'situação', 'instructor status', 'staffing', 'status']],
  ['headcount', ['alunos', 'n de alunos', 'numero de alunos', 'número de alunos', 'participantes', 'lotacao', 'lotação', 'headcount', 'swimmers', 'participants', 'count']],
  ['category', ['categoria', 'category']],
  ['level', ['nivel', 'nível', 'escalao', 'escalão', 'level']],
  ['notes', ['notas', 'observacoes', 'observações', 'obs', 'notes', 'remarks', 'comments']],
];

/**
 * Columns that must look like what they claim to be.
 *
 * The register's importer learned this the expensive way: a header alone is not
 * evidence, because two neighbouring columns can both be called something close
 * to "Nome". A duration column of words and a headcount column of words are both
 * somebody's mistake, and reading them as numbers would put a class of "Manhã"
 * swimmers in the register.
 */
const EXPECTED_SHAPE: Partial<Record<BookingField, (looks: string[]) => boolean>> = {
  durationMinutes: (looks) => looks.some((shape) => /^\d+ digits$/.test(shape)),
  headcount: (looks) => looks.some((shape) => /^\d+ digits$/.test(shape)),
};

export const BOOKING_MATCH: MatchSpec<BookingField> = {
  empty: EMPTY_BOOKING_MAPPING,
  synonyms: SYNONYMS,
  expectedShape: EXPECTED_SHAPE,
};

/** Which column is which, with how sure it is about each. */
export function matchBookingColumns(sheet: Sheet): MatchResult<BookingField> {
  return matchFields(sheet, BOOKING_MATCH);
}
