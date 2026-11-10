import type { PoolseModule } from '@poolse/rules';
import type { OrganizationKind } from '@/lib/api';
import { OFFICE, STAFF, pathOf, visibleDestinations, type Viewer } from './nav-entries.ts';

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
  '/dashboard/facilities': { 'pt-PT': ['piscinas', 'tanques', 'site', 'instalacao', 'agua', 'analises', 'cloro', 'ph'], en: ['pools', 'site', 'facility'] },
  '/dashboard/facilities/inventory': { 'pt-PT': ['armazem', 'material', 'stock'], en: ['stock', 'equipment', 'store room'] },
  '/dashboard/facilities/incidents': { 'pt-PT': ['acidentes', 'incidentes', 'ocorrencia'], en: ['accidents', 'incidents'] },
  '/dashboard/facilities/lifeguards': {
    'pt-PT': ['vigilancia', 'vigilância', 'nadadores salvadores', 'nadador salvador', 'escala'],
    en: ['lifeguards', 'lifeguard', 'roster'],
  },
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
  '/dashboard/students/messages': { 'pt-PT': ['emails', 'comunicados'], en: ['emails'] },
  // POOLSE-166: an aviso is shown in the app, never sent.
  '/dashboard/students/avisos': { 'pt-PT': ['aviso', 'avisos na app'], en: ['notice', 'notices', 'aviso'] },
  '/dashboard/students/provas': { 'pt-PT': ['competicao', 'resultados', 'tempos', 'torneios'], en: ['meets', 'results', 'times', 'competition'] },
  '/dashboard/students/provas/minimos': { 'pt-PT': ['tempos de entrada', 'qualificacao'], en: ['entry times', 'qualifying'] },
  '/dashboard/students/provas/escaloes': { 'pt-PT': ['fpn', 'idades'], en: ['age groups', 'fpn'] },
  '/dashboard/students/levels': { 'pt-PT': ['competencias', 'progressao'], en: ['skills', 'progression'] },
  '/dashboard/students/advancement': { 'pt-PT': ['passagens', 'subir de nivel'], en: ['moving up', 'promotion'] },
};

/** A thing the palette can do rather than a page it can open. */
export type CommandRun = { href: string } | { handler: 'toggleTheme' | 'toggleLocale' | 'openNotifications' };

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
  /** The sport a per-sport page belongs to, named after its label — POOLSE-125. */
  sportKey?: string;
  /** A page from the menu, or an action. */
  kind: 'page' | 'action';
  /** A screen of the phone app, offered only there. */
  surface?: 'app';
}

/** Where the bar is open: the backoffice, or the phone app (Rui, 07-11-2026). */
export interface CommandPlace {
  surface?: 'backoffice' | 'app';
  /** A view of somebody's app opens that app and nothing of the backoffice. */
  viewing?: boolean;
}

const FAMILY = ['guardian', 'student'] as const;

/**
 * The daily actions — one declaration each. A page that is a view of another
 * (Em dívida is Faturação's second view) is declared here, so *quotas* lands on
 * the view somebody means rather than the page above it. So is a tab of the site:
 * it has no menu entry, and `/dashboard/facilities/site` finds the site (Rui,
 * 07-11-2026: typing *documents* simply goes there).
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
    id: 'siteDocuments',
    labelKey: 'boletimTemplate.tab',
    run: { href: '/dashboard/facilities/site?tab=documents' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['documentos', 'documents', 'boletim', 'boletim de socio', 'fpn', 'formularios', 'modelos'], en: ['documents', 'forms', 'templates', 'membership form', 'fpn'] },
  },
  {
    id: 'sitePrices',
    labelKey: 'detailTabs.prices',
    run: { href: '/dashboard/facilities/site?tab=prices' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['precos', 'prices', 'tabela', 'mensalidades', 'tarifas', 'descontos'], en: ['prices', 'fees', 'price list', 'discounts'] },
  },
  {
    id: 'siteRegulation',
    labelKey: 'regulation.tab',
    run: { href: '/dashboard/facilities/site?tab=regulation' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['regulamento', 'regulation', 'regras', 'livro de reclamacoes'], en: ['regulation', 'rules', 'complaints book'] },
  },
  {
    id: 'siteClub',
    labelKey: 'clubData.tab',
    run: { href: '/dashboard/facilities/site?tab=general&section=club' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['dados do clube', 'iban', 'mb way', 'pagamentos', 'nif do clube', 'nipc', 'telefone do clube', 'email do clube', 'contactos'], en: ['club details', 'iban', 'mb way', 'payment details', 'contacts'] },
  },
  {
    // The site's Geral (10-11-2026): the names, the morada, distrito and país.
    id: 'siteDetails',
    labelKey: 'facilities.general.commandLabel',
    run: { href: '/dashboard/facilities/site?tab=general&section=details' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['morada', 'morada do clube', 'codigo postal', 'distrito', 'pais', 'localidade', 'nome do clube', 'nome da instalacao'], en: ['address', 'postcode', 'district', 'country', 'club name', 'site name'] },
  },
  {
    // POOLSE-213: who has something to review, turning 18 included (the old Fez 18 anos list).
    id: 'studentsToReview',
    labelKey: 'students.filters.review',
    run: { href: '/dashboard/students?review=1' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['fez 18 anos', 'maioridade', 'alunos por rever', 'rever alunos', 'documentos enviados'], en: ['turned 18', 'coming of age', 'students to review'] },
  },
  {
    // POOLSE-211: the turmas nobody teaches.
    id: 'turmasNoTeacher',
    labelKey: 'dashboard.summary.noInstructorTurmas',
    run: { href: '/dashboard/classes?instructor=none' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['sem professor', 'turmas sem professor', 'professor em falta'], en: ['no teacher', 'unstaffed classes', 'missing instructor'] },
  },
  {
    id: 'siteOccupancy',
    labelKey: 'detailTabs.occupancy',
    run: { href: '/dashboard/facilities/site?tab=occupancy' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['ocupacao', 'lotacao', 'taxa de ocupacao'], en: ['occupancy', 'capacity'] },
  },
  {
    id: 'sitePartners',
    labelKey: 'partners.title',
    run: { href: '/dashboard/facilities/site?tab=partners' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['parcerias', 'parceiros', 'protocolos', 'contratos de parceria'], en: ['partners', 'partnerships', 'agreements'] },
  },
  {
    id: 'siteSpaces',
    labelKey: 'spaces.title',
    run: { href: '/dashboard/facilities/site?tab=spaces' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['espacos', 'balnearios', 'limpeza', 'salas'], en: ['spaces', 'changing rooms', 'cleaning', 'rooms'] },
  },
  {
    id: 'siteMaintenance',
    labelKey: 'maintenance.section',
    run: { href: '/dashboard/facilities/site?tab=maintenance' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['manutencao', 'tarefas', 'avarias', 'reparacoes'], en: ['maintenance', 'tasks', 'faults', 'repairs'] },
  },
  {
    id: 'sitePhotos',
    labelKey: 'facilities.mediaTab',
    run: { href: '/dashboard/facilities/site?tab=photos' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['multimedia', 'fotografias', 'fotos', 'logotipo', 'logo'], en: ['media', 'photos', 'logo'] },
  },
  {
    id: 'archive',
    labelKey: 'archive.title',
    run: { href: '/dashboard/arquivados' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['arquivados', 'arquivo', 'lixo', 'recuperar', 'restaurar', 'apagados'], en: ['archive', 'bin', 'restore', 'deleted'] },
  },
  {
    id: 'viewApp',
    labelKey: 'appView.menu',
    run: { href: '/app/vista' },
    roles: OFFICE,
    kinds: ['business'],
    synonyms: { 'pt-PT': ['ver a app', 'app', 'vista', 'telemovel', 'ver como'], en: ['see the app', 'app', 'view as', 'phone'] },
  },
  {
    id: 'appViews',
    labelKey: 'appView.history.tab',
    run: { href: '/dashboard/profile?tab=app-views' },
    roles: ['owner'],
    kinds: ['business'],
    synonyms: { 'pt-PT': ['vistas da app', 'quem viu', 'registo de vistas'], en: ['app views', 'who viewed'] },
  },
  {
    id: 'supportAccess',
    labelKey: 'support.tab',
    run: { href: '/dashboard/profile?tab=support' },
    roles: ['owner'],
    kinds: ['business'],
    synonyms: { 'pt-PT': ['suporte', 'acesso de suporte', 'ajuda poolse'], en: ['support', 'support access', 'help'] },
  },
  {
    id: 'subscription',
    labelKey: 'palette.action.subscription',
    run: { href: '/dashboard/profile/subscription' },
    roles: ['owner'],
    kinds: ['business'],
    synonyms: { 'pt-PT': ['subscricao', 'licenca', 'plano', 'pagar poolse', 'cartao'], en: ['subscription', 'licence', 'plan', 'card'] },
  },
  // The phone app's own screens: the same list, through the same role filter.
  {
    id: 'appHome',
    labelKey: 'app.tabs.familia.inicio',
    run: { href: '/app/familia' },
    roles: FAMILY,
    surface: 'app',
    synonyms: { 'pt-PT': ['inicio', 'agenda', 'proxima aula', 'hoje'], en: ['home', 'today', 'next lesson'] },
  },
  {
    id: 'appLessons',
    labelKey: 'app.tabs.familia.aulas',
    run: { href: '/app/familia/aulas' },
    roles: FAMILY,
    surface: 'app',
    synonyms: { 'pt-PT': ['aulas', 'calendario', 'horario', 'semana'], en: ['lessons', 'calendar', 'schedule', 'week'] },
  },
  {
    id: 'appProgress',
    labelKey: 'app.tabs.familia.progressos',
    run: { href: '/app/familia/progressos' },
    roles: FAMILY,
    surface: 'app',
    synonyms: { 'pt-PT': ['progressos', 'marcas', 'tempos', 'recordes', 'nivel'], en: ['progress', 'times', 'records', 'level'] },
  },
  {
    id: 'appFees',
    labelKey: 'app.tabs.familia.pagamentos',
    run: { href: '/app/familia/pagamentos' },
    roles: FAMILY,
    surface: 'app',
    synonyms: { 'pt-PT': ['pagamentos', 'mensalidades', 'quotas', 'dividas', 'pagar'], en: ['payments', 'fees', 'pay'] },
  },
  {
    id: 'appDocuments',
    labelKey: 'app.documents.title',
    run: { href: '/app/familia/documentos' },
    roles: FAMILY,
    surface: 'app',
    synonyms: {
      'pt-PT': ['documentos', 'documents', 'boletim', 'fpn', 'exame medico', 'atestado', 'cartao de cidadao'],
      en: ['documents', 'forms', 'medical exam', 'id'],
    },
  },
  {
    id: 'appJoin',
    labelKey: 'app.join.title',
    run: { href: '/app/familia/inscrever' },
    roles: FAMILY,
    surface: 'app',
    synonyms: { 'pt-PT': ['inscrever', 'inscricao', 'nova turma', 'pedir'], en: ['join', 'enrol', 'new class'] },
  },
  {
    id: 'appTeaching',
    labelKey: 'app.teaching.title',
    run: { href: '/app/aulas' },
    roles: ['instructor'],
    surface: 'app',
    synonyms: { 'pt-PT': ['aulas', 'hoje', 'presencas', 'chamada'], en: ['classes', 'today', 'register'] },
  },
  {
    id: 'appQualifications',
    labelKey: 'qualifications.title',
    run: { href: '/app/perfil/qualificacoes' },
    roles: ['instructor'],
    surface: 'app',
    synonyms: { 'pt-PT': ['qualificacoes', 'certificados', 'validade', 'tptd', 'sbv'], en: ['qualifications', 'certificates'] },
  },
  {
    id: 'appDetails',
    labelKey: 'app.profile.myDetails',
    run: { href: '/app/perfil/dados' },
    roles: ['instructor'],
    surface: 'app',
    synonyms: { 'pt-PT': ['os meus dados', 'morada', 'documento', 'contacto de emergencia'], en: ['my details', 'address', 'emergency contact'] },
  },
  {
    id: 'appMaintenance',
    labelKey: 'app.maintenance.title',
    run: { href: '/app/manutencao' },
    roles: ['maintenance'],
    surface: 'app',
    synonyms: { 'pt-PT': ['manutencao', 'tarefas', 'hoje'], en: ['maintenance', 'tasks', 'today'] },
  },
  {
    id: 'appRecord',
    labelKey: 'app.tabs.manutencao.registar',
    run: { href: '/app/manutencao/registar' },
    roles: ['maintenance'],
    surface: 'app',
    synonyms: { 'pt-PT': ['registar', 'limpeza', 'avaria', 'reportar', 'analise'], en: ['record', 'cleaning', 'fault', 'report'] },
  },
  {
    id: 'appProfile',
    labelKey: 'app.tabs.perfil',
    run: { href: '/app/perfil' },
    roles: [...FAMILY, 'instructor', 'maintenance'],
    surface: 'app',
    synonyms: { 'pt-PT': ['perfil', 'conta', 'definicoes', 'palavra-passe'], en: ['profile', 'account', 'settings', 'password'] },
  },
  {
    // POOLSE-212: opens the bell beside the search.
    id: 'notifications',
    labelKey: 'notifications.title',
    run: { handler: 'openNotifications' },
    roles: ['owner', 'admin', 'instructor', 'maintenance'],
    synonyms: { 'pt-PT': ['notificacoes', 'avisos', 'por tratar', 'alertas', 'sino'], en: ['notifications', 'alerts', 'to do', 'bell'] },
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

/** A screen with no menu entry is still a page, whatever declares it; *Ação* does something. */
function opensAPage(action: Omit<Command, 'kind'>): boolean {
  return (
    action.surface === 'app' ||
    action.id.startsWith('site') ||
    ['archive', 'appViews', 'supportAccess', 'subscription'].includes(action.id)
  );
}

/**
 * Everything this viewer may reach from the palette: the sidebar's pages, then the
 * actions. On the phone app, its own screens first; the backoffice's pages only for
 * staff, never for a family, and never under a view, which opens the person's app
 * alone. The filter only decides what is offered: the API answers for every page.
 */
export function commandsFor(viewer: Viewer, place: CommandPlace = {}): Command[] {
  const inApp = place.surface === 'app';
  const staff = !place.viewing && viewer.roles.some((role) => (STAFF as readonly string[]).includes(role));
  const reachable = (command: Omit<Command, 'kind'>): boolean => {
    if (command.surface === 'app') return inApp;
    if (!inApp || staff) return true;
    return !('href' in command.run);
  };
  const seen = new Set<string>();
  const pages: Command[] = [];
  for (const item of visibleDestinations(viewer)) {
    // A sport's group heading is not a page; its entries are, each with the sport.
    if (item.sport !== undefined && item.key === `sport.name.${item.sport}`) continue;
    // A section and its first child may share an address; the palette lists it once.
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    pages.push({
      id: `page:${item.href}`,
      labelKey: item.key,
      ...(item.sport === undefined ? {} : { sportKey: `sport.name.${item.sport}` }),
      run: { href: item.href },
      kind: 'page',
      ...(SYNONYMS[pathOf(item.href)] === undefined ? {} : { synonyms: SYNONYMS[pathOf(item.href)] }),
    });
  }
  const actions = ACTIONS.filter((action) => allowed(action, viewer) && reachable(action)).map(
    (action): Command => ({ ...action, kind: opensAPage(action) ? 'page' : 'action' }),
  );
  return [...(!inApp || staff ? pages : []), ...actions];
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
