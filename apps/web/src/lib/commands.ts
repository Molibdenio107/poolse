import type { PoolseModule } from '@poolse/rules';
import type { OrganizationKind } from '@/lib/api';
import { OFFICE, visibleDestinations, type Viewer } from './nav-entries.ts';

/**
 * What the command palette offers — POOLSE-118.
 *
 * **Pages first, the sidebar's own.** `visibleDestinations` is the sidebar's
 * list through the sidebar's filter, so the palette never offers a page that
 * would refuse its reader (roles, kinds, modules, `unlessRoles` — the same
 * function). **Then a few daily actions**, each one declaration here: a label,
 * who may, its module, and either an address or a handler the palette knows.
 *
 * **Matching is accent- and case-folded**, on the translated label and on the
 * words people actually type — *quotas* for Em dívida, *chamada* for the
 * register — in the reader's language. The words live here, beside the
 * entries, and not in the catalogue: an English synonym is not owed for every
 * Portuguese one.
 */

type Synonyms = { 'pt-PT'?: readonly string[]; en?: readonly string[] };

/** Other words for a page, by its address. */
const SYNONYMS: Record<string, Synonyms> = {
  '/dashboard': { 'pt-PT': ['inicio', 'painel', 'resumo'], en: ['home', 'overview'] },
  '/dashboard/facilities': { 'pt-PT': ['piscinas', 'tanques', 'site', 'instalacao'], en: ['pools', 'site', 'facility'] },
  '/dashboard/facilities/inventory': { 'pt-PT': ['armazem', 'material', 'stock'], en: ['stock', 'equipment', 'store room'] },
  '/dashboard/facilities/incidents': { 'pt-PT': ['acidentes', 'incidentes', 'ocorrencia'], en: ['accidents', 'incidents'] },
  '/dashboard/facilities/lifeguards': { 'pt-PT': ['vigilancia', 'nadadores salvadores', 'escala'], en: ['lifeguards', 'roster'] },
  '/dashboard/facilities/staff': { 'pt-PT': ['funcionarios', 'equipa', 'professores', 'pessoal'], en: ['team', 'employees', 'people'] },
  '/dashboard/facilities/staff/vacations': { 'pt-PT': ['ferias', 'ausencias', 'folgas'], en: ['holidays', 'leave', 'absences'] },
  '/dashboard/facilities/staff/salaries': { 'pt-PT': ['ordenados', 'vencimentos', 'pagamentos'], en: ['pay', 'wages', 'payroll'] },
  '/dashboard/facilities/staff/qualifications': { 'pt-PT': ['certificados', 'cursos', 'validade'], en: ['certificates', 'licences'] },
  '/dashboard/energy': { 'pt-PT': ['luz', 'eletricidade', 'gas', 'contadores', 'faturas de energia'], en: ['electricity', 'gas', 'meters', 'bills'] },
  '/dashboard/classes': { 'pt-PT': ['aulas', 'grupos', 'horario'], en: ['classes', 'groups', 'timetable'] },
  '/dashboard/classes/seasons': { 'pt-PT': ['ano letivo'], en: ['school year'] },
  '/dashboard/classes/reposicoes': { 'pt-PT': ['compensacoes', 'aulas em falta'], en: ['make-up', 'makeup'] },
  '/dashboard/calendar': { 'pt-PT': ['agenda', 'semana', 'grelha', 'pistas'], en: ['schedule', 'week', 'grid', 'lanes'] },
  '/dashboard/calendar/closures': { 'pt-PT': ['feriados', 'fecho', 'obras'], en: ['holidays', 'closed'] },
  '/dashboard/rececao': { 'pt-PT': ['entradas', 'natacao livre', 'bilhetes', 'senhas'], en: ['front desk', 'free swim', 'tickets', 'check-in'] },
  '/dashboard/faturacao': { 'pt-PT': ['faturas', 'recibos', 'cobrancas'], en: ['invoices', 'billing', 'receipts'] },
  '/dashboard/students': { 'pt-PT': ['inscritos', 'nadadores', 'criancas'], en: ['pupils', 'swimmers', 'register'] },
  '/dashboard/students/guardians': { 'pt-PT': ['pais', 'encarregados', 'familias'], en: ['parents', 'families'] },
  '/dashboard/students/pedidos': { 'pt-PT': ['pre-inscricoes', 'interessados', 'lista de espera'], en: ['leads', 'enquiries', 'waiting list'] },
  '/dashboard/students/messages': { 'pt-PT': ['emails', 'avisos', 'comunicados'], en: ['emails', 'notices'] },
  '/dashboard/students/provas': { 'pt-PT': ['competicao', 'resultados', 'tempos', 'torneios'], en: ['meets', 'results', 'times', 'competition'] },
  '/dashboard/students/provas/minimos': { 'pt-PT': ['tempos de entrada', 'qualificacao'], en: ['entry times', 'qualifying'] },
  '/dashboard/students/provas/escaloes': { 'pt-PT': ['fpn', 'idades'], en: ['age groups', 'fpn'] },
  '/dashboard/students/levels': { 'pt-PT': ['competencias', 'progressao'], en: ['skills', 'progression'] },
  '/dashboard/students/advancement': { 'pt-PT': ['passagens', 'subir de nivel'], en: ['moving up', 'promotion'] },
};

/** A thing the palette can do rather than a page it can open. */
export type CommandRun = { href: string } | { handler: 'toggleTheme' | 'toggleLocale' };

export interface Command {
  id: string;
  /** A catalogue key — the label in the reader's language. */
  labelKey: string;
  run: CommandRun;
  /** Absent means everybody. */
  roles?: readonly string[];
  module?: PoolseModule;
  kinds?: readonly OrganizationKind[];
  synonyms?: Synonyms;
  /** A page from the menu, or an action. */
  kind: 'page' | 'action';
}

/**
 * The daily actions — one declaration each. A page that is a view of another
 * (Em dívida is Faturação's second view) is declared here, so *quotas* lands on
 * the view somebody means rather than the page above it.
 */
const ACTIONS: Omit<Command, 'kind'>[] = [
  {
    id: 'owing',
    labelKey: 'palette.action.owing',
    run: { href: '/dashboard/faturacao?view=owing' },
    roles: OFFICE,
    module: 'invoicing',
    kinds: ['business'],
    synonyms: {
      'pt-PT': ['quotas', 'em divida', 'dividas', 'devedores', 'atrasos', 'mensalidades em atraso'],
      en: ['overdue', 'debts', 'owing', 'unpaid'],
    },
  },
  {
    id: 'register',
    labelKey: 'palette.action.register',
    // The instructor's own week (`/app/aulas`), whose API answers instructors
    // only; the office reaches a register through Calendário.
    run: { href: '/app/aulas' },
    roles: ['instructor'],
    kinds: ['business'],
    synonyms: { 'pt-PT': ['registo', 'presencas', 'chamada', 'faltas'], en: ['register', 'attendance', 'roll call'] },
  },
  {
    id: 'newStudent',
    labelKey: 'palette.action.newStudent',
    run: { href: '/dashboard/students/new' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['novo aluno', 'nova aluna', 'inscrever', 'inscricao'], en: ['add student', 'enrol', 'enroll'] },
  },
  {
    id: 'importStudents',
    labelKey: 'palette.action.importStudents',
    run: { href: '/dashboard/students/import' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['importar', 'excel', 'folha', 'ficheiro'], en: ['import', 'spreadsheet', 'excel'] },
  },
  {
    id: 'theme',
    labelKey: 'palette.action.theme',
    run: { handler: 'toggleTheme' },
    synonyms: { 'pt-PT': ['tema', 'escuro', 'claro', 'modo noturno'], en: ['theme', 'dark', 'light', 'night mode'] },
  },
  {
    id: 'locale',
    labelKey: 'palette.action.locale',
    run: { handler: 'toggleLocale' },
    synonyms: { 'pt-PT': ['idioma', 'lingua', 'ingles', 'english'], en: ['language', 'portuguese', 'portugues'] },
  },
];

function allowed(command: Omit<Command, 'kind'>, viewer: Viewer): boolean {
  const byRole = command.roles === undefined || command.roles.some((role) => viewer.roles.includes(role));
  const byKind = command.kinds === undefined || command.kinds.includes(viewer.kind);
  const byModule = command.module === undefined || viewer.modules.includes(command.module);
  return byRole && byKind && byModule;
}

/** Everything this viewer may reach from the palette: the sidebar's pages, then the actions. */
export function commandsFor(viewer: Viewer): Command[] {
  const seen = new Set<string>();
  const pages: Command[] = [];
  for (const item of visibleDestinations(viewer)) {
    // A section and its first child may share an address; the palette lists it once.
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    pages.push({
      id: `page:${item.href}`,
      labelKey: item.key,
      run: { href: item.href },
      kind: 'page',
      ...(SYNONYMS[item.href] === undefined ? {} : { synonyms: SYNONYMS[item.href] }),
    });
  }
  const actions = ACTIONS.filter((action) => allowed(action, viewer)).map(
    (action): Command => ({ ...action, kind: 'action' }),
  );
  return [...pages, ...actions];
}

/** Lower case, no accents: *Dívida*, *divida* and *DÍVIDA* are one word. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * How well a query fits a command, or null for not at all — label before
 * synonym, a word's start before its middle. The reader's language only: in
 * `en`, *quotas* is not a word for Em dívida.
 */
export function score(command: Command, label: string, query: string, locale: string): number | null {
  const q = fold(query);
  if (q === '') return 0;
  const name = fold(label);
  const words = (command.synonyms?.[locale === 'en' ? 'en' : 'pt-PT'] ?? []).map(fold);
  const startsWord = (text: string): boolean => text.startsWith(q) || text.split(/[\s/-]+/).some((part) => part.startsWith(q));

  if (name.startsWith(q)) return 100;
  if (startsWord(name)) return 90;
  if (words.some((word) => word.startsWith(q))) return 80;
  if (words.some(startsWord)) return 70;
  if (name.includes(q)) return 50;
  if (words.some((word) => word.includes(q))) return 40;
  return null;
}
