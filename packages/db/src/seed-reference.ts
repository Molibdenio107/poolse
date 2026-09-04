import type pg from 'pg';

/**
 * The reference schedule, rebuilt inside Poolse — POOLSE-55.
 *
 * Every ticket from POOLSE-43 to 54 was designed against one real document: the
 * Ginásio Clube de Santo Tirso 2025/2026 timetable. **This is the acceptance of
 * the whole feature**, and it is deliberately allowed to fail: if something on
 * that sheet cannot be expressed, the answer is to change the model and write
 * the finding into the ticket — never to fudge it here. A seed that quietly
 * works around the one case the model gets wrong removes the only signal there
 * was.
 *
 * ---------------------------------------------------------------------------
 * Three decisions worth knowing before changing anything here
 * ---------------------------------------------------------------------------
 *
 * **It fills the organization's existing facility. It never creates one.** The
 * first version made a facility of its own, to keep forty seeded bookings off a
 * club somebody had been typing into by hand — which solved a real problem by
 * breaking a product rule: **an organization's licence covers one site**, and a
 * seed that quietly adds a second is a seed that hands somebody a plan they have
 * not bought. `docs/data-model.md` keeps multi-facility in the *schema* on
 * purpose — a municipality with two buildings should not need two organizations
 * — but how many a tenant may have is the licence's question, not the seed's.
 *
 * The trampling problem is solved the honest way instead: this whole function is
 * **opt-in**, behind `SEED_REFERENCE=yes`. An ordinary `pnpm db:seed` leaves the
 * timetable alone; somebody who wants the reference week asks for it, and knows
 * what they are asking for.
 *
 * **It writes to the real tables with every constraint and trigger live.** The
 * ticket asks for the seed to go through "the same rules the API enforces", and
 * the honest position is that it cannot go through the same repository
 * *functions*: those live in `apps/api` and this package cannot import them —
 * the same barrier POOLSE-51 hit when it had to invent `packages/rules`. What
 * matters is the part that can be done, and is: nothing is deferred, nothing is
 * disabled, and the opening-hours trigger, the subject CHECK, the partial unique
 * indexes, the lane exclusion constraint and POOLSE-53's instructor state
 * machine all judge this data as it goes in. If the reference week is not
 * expressible, this throws.
 *
 * **`instructor_status` is not writable here in the way it looks.** POOLSE-53
 * made it a state machine: a booking whose turma has an instructor becomes
 * `assigned` however it was inserted. So the bookings that must read `uncovered`
 * or `to_define` are hung on turmas with no instructor at all — which is also
 * what the real September looks like, and is why those turmas exist.
 *
 * Idempotent throughout: every row is matched on a natural key first, so running
 * it twice adds only what is missing and never produces two Santo Tirsos.
 */

const MAIN_POOL = 'Tanque Principal';
const LEARNING_POOL = 'Tanque de Aprendizagem';

/**
 * The reference sheet's own hours.
 *
 * Two things a generated lattice never has, and both are the point: the **hole
 * between 11:45 and 14:45**, where the pool is quiet and nothing models it, and
 * a **06:30** row that exists because the masters swim before work. The weekend
 * is a different list entirely, which is what POOLSE-44's `day_group` is for.
 */
const SLOTS: Record<'weekday' | 'saturday', [string, string][]> = {
  weekday: [
    ['06:30', '07:15'],
    ['08:45', '09:30'],
    ['09:30', '10:15'],
    ['10:15', '11:00'],
    ['11:00', '11:45'],
    ['11:45', '12:30'],
    ['14:45', '15:30'],
    ['15:30', '16:15'],
    ['16:15', '17:00'],
    ['17:00', '17:45'],
    ['17:45', '18:30'],
    ['18:30', '19:15'],
    ['19:15', '20:00'],
    ['20:00', '20:45'],
    ['21:00', '21:45'],
  ],
  saturday: [
    ['07:30', '08:00'],
    ['08:00', '08:45'],
    ['09:30', '10:15'],
    ['10:15', '11:00'],
    ['11:00', '11:45'],
    ['11:45', '12:30'],
  ],
};

/**
 * The five categories the sheet colour-codes by, and their tokens.
 *
 * Not hexes: `category_colour` is an enum of six design tokens the web app
 * resolves per theme, which is what keeps a category legible in dark mode and
 * on a photocopy. A club picking its own hex is a decision POOLSE-49 declined.
 */
const CATEGORIES: { name: string; colour: string }[] = [
  { name: 'Competição', colour: 'blue' },
  { name: 'Hidroginástica', colour: 'teal' },
  { name: 'Desporto escolar', colour: 'green' },
  { name: 'Parcerias', colour: 'violet' },
  { name: 'Manutenção', colour: 'slate' },
];

/**
 * The four partner entities on the sheet, and their groups.
 *
 * **The class names are the awkward ones on purpose.** `10G 11B`, `11H/I` and
 * `12 F/I` carry spaces, slashes and digits, and they are what the partner
 * import and the partial unique indexes get judged on — 55.10 and 55.11. A seed
 * of tidy names would prove nothing about the names a school actually sends.
 */
const PARTNERS: {
  name: string;
  type: string;
  nif: string | null;
  colour: string | null;
  groups: {
    name: string;
    count: number;
    tag: string | null;
    ownInstructor: string | null;
    notes: string | null;
  }[];
}[] = [
  {
    name: 'Escola Secundária D. Dinis',
    type: 'escola',
    nif: '600078432',
    colour: '#67a6b6',
    groups: [
      { name: '6A', count: 24, tag: 'DE', ownInstructor: 'Prof. Silva', notes: null },
      { name: '6B', count: 22, tag: 'DE', ownInstructor: null, notes: null },
      { name: '10G 11B', count: 27, tag: 'DE', ownInstructor: 'Prof. Marques', notes: null },
      { name: '11H/I', count: 25, tag: 'DE', ownInstructor: null, notes: null },
      { name: '12 F/I', count: 19, tag: 'DE', ownInstructor: 'Prof. Marques', notes: null },
    ],
  },
  {
    name: 'Santa Casa da Misericórdia de Santo Tirso',
    type: 'ipss_misericordia',
    nif: '500745291',
    colour: '#b3d49d',
    groups: [
      {
        name: 'Hidroterapia',
        count: 8,
        tag: null,
        ownInstructor: null,
        notes: 'Acesso pela rampa. Precisa de duas monitoras.',
      },
    ],
  },
  {
    name: 'Jardim de Infância O Pinheirinho',
    // `jardim_infancia`, not `escola`. The enum has the distinction because a
    // club prices and schedules the two differently, and a seed that flattened
    // them would leave one of the eight partner types never exercised.
    type: 'jardim_infancia',
    nif: '502113847',
    colour: '#e0b062',
    groups: [
      { name: 'Sala dos 4 anos', count: 16, tag: null, ownInstructor: null, notes: null },
      { name: 'Sala dos 5 anos', count: 18, tag: null, ownInstructor: 'Educadora Rita', notes: null },
    ],
  },
  {
    name: 'Andebol Clube de Santo Tirso',
    type: 'clube',
    nif: '503998211',
    colour: '#c98a8a',
    groups: [
      { name: 'Sub-16', count: 18, tag: null, ownInstructor: 'Pedro Sousa', notes: null },
    ],
  },
];

/**
 * The reference site's own instructors, and why it does not borrow the club's.
 *
 * The first version of this seed used whatever instructors the organization
 * already had, and `class_session_instructor_free` refused it — correctly. That
 * constraint is **org-wide and crosses facilities**: it asks whether one person
 * is in two *pools* at overlapping times, and two facilities are two sets of
 * pools. A developer's club with a Monday 06:30 class of its own therefore
 * cannot lend that instructor to a reference site running at 06:30 on the same
 * Monday, because nobody can be in two buildings at once.
 *
 * That is the model being right rather than in the way — a person's time is a
 * resource the whole organization shares. So the reference schedule brings its
 * own staff, which is also what makes it self-contained.
 */
const REF_STAFF = [
  { first: 'Sandra', last: 'Moreira' },
  { first: 'Nuno', last: 'Teixeira' },
  { first: 'Cláudia', last: 'Pinto' },
  { first: 'Ricardo', last: 'Alves' },
  { first: 'Joana', last: 'Faria' },
];

/**
 * The reference club's turmas.
 *
 * `staffed: false` is not an oversight — those are the turmas whose bookings
 * have to read `uncovered` or `to_define`, and POOLSE-53's trigger will hand a
 * booking `assigned` the moment its turma has anybody. September at a real club
 * looks exactly like this.
 *
 * Names are distinct from anything a developer is likely to have typed by hand,
 * because `class_group_name_uq` is unique **org-wide** — a settled decision, and
 * one that means a collision here would silently attach a reference booking to
 * somebody else's turma on another site.
 */
const TURMAS: {
  name: string;
  level: string | null;
  pool: 'main' | 'learning';
  /** Index into the instructor list, or null for a turma nobody is running yet. */
  staff: number | null;
  capacity: number;
}[] = [
  { name: 'Ref · Pré-Competição A', level: 'Cadetes', pool: 'main', staff: 0, capacity: 18 },
  { name: 'Ref · Pré-Competição B', level: 'Cadetes', pool: 'main', staff: 0, capacity: 18 },
  { name: 'Ref · Infantis A', level: 'Infantis', pool: 'main', staff: 1, capacity: 12 },
  { name: 'Ref · Infantis B', level: 'Infantis', pool: 'main', staff: 1, capacity: 12 },
  { name: 'Ref · Juvenis A', level: 'Juvenis', pool: 'main', staff: 1, capacity: 12 },
  { name: 'Ref · Absolutos', level: 'Juniores', pool: 'main', staff: 2, capacity: 16 },
  { name: 'Ref · Masters Manhã', level: 'Masters', pool: 'main', staff: 3, capacity: 18 },
  { name: 'Ref · Aprendizagem 1', level: 'Petizes', pool: 'main', staff: 4, capacity: 10 },
  { name: 'Ref · Aprendizagem 2', level: 'Petizes', pool: 'main', staff: 4, capacity: 10 },
  { name: 'Ref · Hidro Sénior A', level: 'Hidroginástica Sénior', pool: 'main', staff: 2, capacity: 24 },
  { name: 'Ref · Bebés Sábado', level: 'Natação para Bebés', pool: 'learning', staff: 4, capacity: 8 },
  { name: 'Ref · Adaptada', level: 'Natação adaptada', pool: 'learning', staff: 3, capacity: 6 },
  // The four with nobody on them — the September gap this whole feature exists
  // to make visible.
  { name: 'Ref · Aperfeiçoamento 1', level: 'Benjamins', pool: 'main', staff: null, capacity: 12 },
  { name: 'Ref · Aperfeiçoamento 2', level: 'Benjamins', pool: 'main', staff: null, capacity: 12 },
  { name: 'Ref · Juvenis B', level: 'Juvenis', pool: 'main', staff: null, capacity: 12 },
  { name: 'Ref · Hidro Sénior B', level: 'Hidroginástica Sénior', pool: 'main', staff: null, capacity: 24 },
];

type Status = 'assigned' | 'to_define' | 'external' | 'uncovered';

/**
 * The week itself. `lanes` are 1-based positions in the named pool.
 *
 * Read it as the sheet reads: a row per block, left to right. The cases the
 * ticket asks for are marked in the comments beside them.
 */
const WEEK: {
  turma?: string;
  group?: string;
  title?: string;
  subject?: 'turma' | 'parceria' | 'evento' | 'manutencao';
  weekday: number;
  start: string;
  minutes: number;
  pool: 'main' | 'learning';
  lanes: number[];
  category: string;
  status?: Status;
}[] = [
  // 06:30 — the masters, before work. Three mornings, three lanes.
  { turma: 'Ref · Masters Manhã', weekday: 1, start: '06:30', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Competição' },
  { turma: 'Ref · Masters Manhã', weekday: 3, start: '06:30', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Competição' },
  { turma: 'Ref · Masters Manhã', weekday: 5, start: '06:30', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Competição' },

  // Mid-morning: the school, booked class by class. Two groups side by side.
  { group: '6A', weekday: 1, start: '09:30', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Desporto escolar' },
  { group: '6B', weekday: 1, start: '09:30', minutes: 45, pool: 'main', lanes: [4, 5, 6], category: 'Desporto escolar' },
  { group: '10G 11B', weekday: 2, start: '10:15', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Desporto escolar' },
  { group: '11H/I', weekday: 2, start: '10:15', minutes: 45, pool: 'main', lanes: [4, 5, 6], category: 'Desporto escolar' },
  { group: '12 F/I', weekday: 4, start: '10:15', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Desporto escolar' },
  { group: '6A', weekday: 4, start: '09:30', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Desporto escolar' },
  { group: '6B', weekday: 4, start: '09:30', minutes: 45, pool: 'main', lanes: [4, 5, 6], category: 'Desporto escolar' },

  // The Misericórdia, and the jardim de infância in the learning tank.
  { group: 'Hidroterapia', weekday: 3, start: '11:00', minutes: 45, pool: 'main', lanes: [1, 2], category: 'Parcerias' },
  { group: 'Hidroterapia', weekday: 5, start: '11:00', minutes: 45, pool: 'main', lanes: [1, 2], category: 'Parcerias' },
  { group: 'Sala dos 4 anos', weekday: 2, start: '11:00', minutes: 45, pool: 'learning', lanes: [1], category: 'Parcerias' },
  { group: 'Sala dos 5 anos', weekday: 4, start: '11:00', minutes: 45, pool: 'learning', lanes: [1], category: 'Parcerias' },

  // Manutenção in the quiet hour after lunch — a booking with no subject at all.
  { title: 'Aspiração e análises', subject: 'manutencao', weekday: 4, start: '14:45', minutes: 45, pool: 'main', lanes: [1, 2, 3, 4, 5, 6], category: 'Manutenção' },

  // Afternoon school of swimming.
  { turma: 'Ref · Aprendizagem 1', weekday: 1, start: '17:00', minutes: 45, pool: 'main', lanes: [1], category: 'Competição' },
  { turma: 'Ref · Aprendizagem 2', weekday: 1, start: '17:00', minutes: 45, pool: 'main', lanes: [2], category: 'Competição' },
  { turma: 'Ref · Aprendizagem 1', weekday: 3, start: '17:00', minutes: 45, pool: 'main', lanes: [1], category: 'Competição' },
  { turma: 'Ref · Aprendizagem 2', weekday: 3, start: '17:00', minutes: 45, pool: 'main', lanes: [2], category: 'Competição' },

  // The two unstaffed turmas — `to_define`, because nobody has decided yet.
  { turma: 'Ref · Aperfeiçoamento 1', weekday: 2, start: '17:45', minutes: 45, pool: 'main', lanes: [1], category: 'Competição', status: 'to_define' },
  { turma: 'Ref · Aperfeiçoamento 2', weekday: 2, start: '17:45', minutes: 45, pool: 'main', lanes: [2], category: 'Competição', status: 'to_define' },

  // And the three the club has escalated — `uncovered`, September's real problem.
  { turma: 'Ref · Aperfeiçoamento 1', weekday: 4, start: '17:45', minutes: 45, pool: 'main', lanes: [1], category: 'Competição', status: 'uncovered' },
  { turma: 'Ref · Aperfeiçoamento 2', weekday: 4, start: '17:45', minutes: 45, pool: 'main', lanes: [2], category: 'Competição', status: 'uncovered' },
  { turma: 'Ref · Juvenis B', weekday: 5, start: '18:30', minutes: 45, pool: 'main', lanes: [5], category: 'Competição', status: 'uncovered' },

  // Hidroginástica across the whole tank — 55.4, one booking on six lanes.
  { turma: 'Ref · Hidro Sénior A', weekday: 1, start: '18:30', minutes: 45, pool: 'main', lanes: [1, 2, 3, 4, 5, 6], category: 'Hidroginástica' },
  { turma: 'Ref · Hidro Sénior A', weekday: 3, start: '18:30', minutes: 45, pool: 'main', lanes: [1, 2, 3, 4, 5, 6], category: 'Hidroginástica' },
  { turma: 'Ref · Hidro Sénior B', weekday: 5, start: '11:45', minutes: 45, pool: 'main', lanes: [1, 2, 3, 4], category: 'Hidroginástica', status: 'to_define' },

  /*
   * The Sandra case — 55.5, and criterion 7.
   *
   * One instructor running three groups at once on three adjacent lanes of one
   * tank. This is the club's ordinary Tuesday and the single thing POOLSE-51
   * says a scheduler must not refuse; if loading this seed trips a conflict
   * rule, the rule is wrong and not the schedule.
   */
  { turma: 'Ref · Infantis A', weekday: 2, start: '19:15', minutes: 45, pool: 'main', lanes: [2], category: 'Competição' },
  { turma: 'Ref · Infantis B', weekday: 2, start: '19:15', minutes: 45, pool: 'main', lanes: [3], category: 'Competição' },
  { turma: 'Ref · Juvenis A', weekday: 2, start: '19:15', minutes: 45, pool: 'main', lanes: [4], category: 'Competição' },
  { turma: 'Ref · Absolutos', weekday: 2, start: '19:15', minutes: 90, pool: 'main', lanes: [5, 6], category: 'Competição' },

  // The same three again on Thursday, so the concurrency badge is not a one-off.
  { turma: 'Ref · Infantis A', weekday: 4, start: '19:15', minutes: 45, pool: 'main', lanes: [2], category: 'Competição' },
  { turma: 'Ref · Infantis B', weekday: 4, start: '19:15', minutes: 45, pool: 'main', lanes: [3], category: 'Competição' },
  { turma: 'Ref · Juvenis A', weekday: 4, start: '19:15', minutes: 45, pool: 'main', lanes: [4], category: 'Competição' },

  // Evening squads. A 90-minute block, so a class crossing two rows is on the sheet.
  { turma: 'Ref · Pré-Competição A', weekday: 1, start: '20:00', minutes: 90, pool: 'main', lanes: [1, 2, 3], category: 'Competição' },
  { turma: 'Ref · Pré-Competição A', weekday: 3, start: '20:00', minutes: 90, pool: 'main', lanes: [1, 2, 3], category: 'Competição' },
  { turma: 'Ref · Pré-Competição B', weekday: 5, start: '20:00', minutes: 90, pool: 'main', lanes: [1, 2, 3], category: 'Competição' },

  // The handball club takes the whole tank late on a Friday.
  { group: 'Sub-16', weekday: 5, start: '21:00', minutes: 45, pool: 'main', lanes: [1, 2, 3, 4, 5, 6], category: 'Parcerias' },

  // The learning tank, which has no lanes of its own — 55.7.
  { turma: 'Ref · Adaptada', weekday: 1, start: '16:15', minutes: 45, pool: 'learning', lanes: [1], category: 'Parcerias' },
  { turma: 'Ref · Adaptada', weekday: 3, start: '16:15', minutes: 45, pool: 'learning', lanes: [1], category: 'Parcerias' },

  // Saturday, on its own set of rows.
  { turma: 'Ref · Masters Manhã', weekday: 6, start: '07:30', minutes: 30, pool: 'main', lanes: [1, 2], category: 'Competição' },
  { turma: 'Ref · Bebés Sábado', weekday: 6, start: '09:30', minutes: 45, pool: 'learning', lanes: [1], category: 'Parcerias' },
  { turma: 'Ref · Hidro Sénior A', weekday: 6, start: '09:30', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Hidroginástica' },
  { turma: 'Ref · Hidro Sénior B', weekday: 6, start: '10:15', minutes: 45, pool: 'main', lanes: [1, 2, 3], category: 'Hidroginástica', status: 'uncovered' },
  { turma: 'Ref · Pré-Competição B', weekday: 6, start: '11:00', minutes: 45, pool: 'main', lanes: [1, 2, 3, 4], category: 'Competição' },
];

export interface ReferenceCounts {
  facility: number;
  staff: number;
  pools: number;
  lanes: number;
  slots: number;
  categories: number;
  partners: number;
  groups: number;
  turmas: number;
  bookings: number;
  sessions: number;
  skipped: string[];
}

async function one<T extends pg.QueryResultRow>(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const { rows } = await client.query<T>(sql, params);
  return rows[0] ?? null;
}

export async function seedReferenceSchedule(
  client: pg.Client,
  organizationId: string,
): Promise<ReferenceCounts> {
  const counts: ReferenceCounts = {
    facility: 0,
    staff: 0,
    pools: 0,
    lanes: 0,
    slots: 0,
    categories: 0,
    partners: 0,
    groups: 0,
    turmas: 0,
    bookings: 0,
    sessions: 0,
    skipped: [],
  };

  /*
   * The season has to be published, or `generate_sessions` refuses it and half
   * the verification has nothing to look at — POOLSE-45, and criterion 5.
   */
  const season = await one<{ id: string; starts_on: string; ends_on: string }>(
    client,
    `SELECT id, starts_on::text, ends_on::text
       FROM season
      WHERE organization_id = $1 AND status = 'published' AND archived_at IS NULL
      ORDER BY starts_on DESC LIMIT 1`,
    [organizationId],
  );

  if (season === null) {
    counts.skipped.push('no published season — the reference schedule needs one');
    return counts;
  }

  /*
   * The organization's own site — never a new one.
   *
   * One facility per licence, so the reference schedule is built *into* whatever
   * site the club already has rather than beside it. If there is none, there is
   * nothing to build on and saying so beats inventing one.
   */
  const facility = await one<{ id: string; name: string }>(
    client,
    `SELECT id, name FROM facility
      WHERE organization_id = $1 AND archived_at IS NULL
      ORDER BY created_at LIMIT 1`,
    [organizationId],
  );

  if (facility === null) {
    counts.skipped.push('no facility — the reference schedule fills one, it does not create one');
    return counts;
  }

  const facilityId = facility.id;
  counts.facility = 0;

  // ------------------------------------------------------------- the two tanks
  const pools: Record<'main' | 'learning', string> = { main: '', learning: '' };

  for (const [key, name, lanesEnabled] of [
    ['main', MAIN_POOL, true],
    ['learning', LEARNING_POOL, false],
  ] as const) {
    let pool = await one<{ id: string }>(
      client,
      `SELECT id FROM pool
        WHERE organization_id = $1 AND facility_id = $2 AND name = $3 AND archived_at IS NULL`,
      [organizationId, facilityId, name],
    );

    if (pool === null) {
      pool = await one<{ id: string }>(
        client,
        `INSERT INTO pool (organization_id, facility_id, name, kind, lanes_enabled)
         VALUES ($1, $2, $3, 'indoor', $4) RETURNING id`,
        [organizationId, facilityId, name, lanesEnabled],
      );
      counts.pools += 1;

      /*
       * Every pool arrives with exactly one lane named after itself — the
       * invariant "a pool without lanes is a pool with one lane", enforced by a
       * trigger so a seed cannot forget it. The main tank is then widened to
       * six, which is what the lane editor does; the learning tank keeps its
       * single implicit lane, which is the path 55.7 exercises.
       */
      if (lanesEnabled) {
        await client.query(`UPDATE lane SET name = 'Pista 1' WHERE pool_id = $1 AND position = 1`, [
          pool!.id,
        ]);
        await client.query(
          `INSERT INTO lane (organization_id, pool_id, name, position)
           SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 6) AS n`,
          [organizationId, pool!.id],
        );
        counts.lanes += 6;
      } else {
        counts.lanes += 1;
      }
    }

    pools[key] = pool!.id;
  }

  /** Lane ids by pool and 1-based position, which is how `WEEK` names them. */
  const laneAt = new Map<string, string>();
  for (const row of (
    await client.query<{ pool_id: string; position: number; id: string }>(
      `SELECT id, pool_id, position FROM lane
        WHERE pool_id = ANY($1::uuid[]) AND archived_at IS NULL`,
      [[pools.main, pools.learning]],
    )
  ).rows) {
    laneAt.set(`${row.pool_id}:${row.position}`, row.id);
  }

  // ------------------------------------------------------------ the slot grid
  for (const [group, hours] of Object.entries(SLOTS)) {
    for (const [from, to] of hours) {
      const already = await one<{ id: string }>(
        client,
        `SELECT id FROM facility_time_slot
          WHERE organization_id = $1 AND facility_id = $2 AND season_id = $3
            AND day_group = $4::day_group AND start_time = $5::time AND archived_at IS NULL`,
        [organizationId, facilityId, season.id, group, from],
      );
      if (already) continue;

      await client.query(
        `INSERT INTO facility_time_slot
           (organization_id, facility_id, season_id, day_group, start_time, end_time)
         VALUES ($1, $2, $3, $4::day_group, $5::time, $6::time)`,
        [organizationId, facilityId, season.id, group, from, to],
      );
      counts.slots += 1;
    }
  }

  const slotAt = new Map<string, string>();
  for (const row of (
    await client.query<{ id: string; day_group: string; start_time: string }>(
      `SELECT id, day_group::text, start_time::text FROM facility_time_slot
        WHERE organization_id = $1 AND facility_id = $2 AND season_id = $3 AND archived_at IS NULL`,
      [organizationId, facilityId, season.id],
    )
  ).rows) {
    slotAt.set(`${row.day_group}:${row.start_time.slice(0, 5)}`, row.id);
  }

  // ------------------------------------------------------------- the categories
  const categoryAt = new Map<string, string>();
  for (const category of CATEGORIES) {
    let found = await one<{ id: string }>(
      client,
      `SELECT id FROM booking_category
        WHERE organization_id = $1 AND facility_id = $2 AND name = $3 AND archived_at IS NULL`,
      [organizationId, facilityId, category.name],
    );

    if (found === null) {
      found = await one<{ id: string }>(
        client,
        `INSERT INTO booking_category (organization_id, facility_id, name, colour)
         VALUES ($1, $2, $3, $4::category_colour) RETURNING id`,
        [organizationId, facilityId, category.name, category.colour],
      );
      counts.categories += 1;
    }

    categoryAt.set(category.name, found!.id);
  }

  // --------------------------------------------------------------- the partners
  const groupAt = new Map<string, string>();
  for (const partner of PARTNERS) {
    let found = await one<{ id: string }>(
      client,
      `SELECT id FROM partner
        WHERE organization_id = $1 AND facility_id = $2 AND name = $3 AND archived_at IS NULL`,
      [organizationId, facilityId, partner.name],
    );

    if (found === null) {
      found = await one<{ id: string }>(
        client,
        `INSERT INTO partner (organization_id, facility_id, name, type, nif, color)
         VALUES ($1, $2, $3, $4::partner_type, $5, $6) RETURNING id`,
        [organizationId, facilityId, partner.name, partner.type, partner.nif, partner.colour],
      );
      counts.partners += 1;
    }

    for (const group of partner.groups) {
      let existing = await one<{ id: string }>(
        client,
        `SELECT id FROM partner_group
          WHERE organization_id = $1 AND partner_id = $2 AND name = $3 AND archived_at IS NULL`,
        [organizationId, found!.id, group.name],
      );

      if (existing === null) {
        existing = await one<{ id: string }>(
          client,
          `INSERT INTO partner_group
             (organization_id, partner_id, name, participant_count,
              brings_own_instructor, own_instructor_name, tag, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            organizationId,
            found!.id,
            group.name,
            group.count,
            group.ownInstructor !== null,
            group.ownInstructor,
            group.tag,
            group.notes,
          ],
        );
        counts.groups += 1;
      }

      groupAt.set(group.name, existing!.id);
    }
  }

  // ----------------------------------------------------------------- the turmas
  const instructors: string[] = [];
  for (const person of REF_STAFF) {
    const email = `ref.${person.first}.${person.last}@santotirso.invalid`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    let member = await one<{ id: string }>(
      client,
      `SELECT id FROM membership
        WHERE organization_id = $1 AND email = $2::citext AND archived_at IS NULL`,
      [organizationId, email],
    );

    if (member === null) {
      member = await one<{ id: string }>(
        client,
        `INSERT INTO membership (organization_id, status, first_name, last_name, email)
         VALUES ($1, 'active', $2, $3, $4::citext) RETURNING id`,
        [organizationId, person.first, person.last, email],
      );
      await client.query(
        `INSERT INTO membership_role (organization_id, membership_id, role)
         VALUES ($1, $2, 'instructor') ON CONFLICT DO NOTHING`,
        [organizationId, member!.id],
      );
      counts.staff += 1;
    }

    instructors.push(member!.id);
  }

  const levelAt = new Map<string, string>();
  for (const row of (
    await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM student_level WHERE organization_id = $1 AND archived_at IS NULL`,
      [organizationId],
    )
  ).rows) {
    levelAt.set(row.name, row.id);
  }

  const turmaAt = new Map<string, string>();
  for (const turma of TURMAS) {
    /*
     * Checked org-wide, not per facility. `class_group_name_uq` is unique across
     * the organization — a settled decision — so a name already in use somewhere
     * else would either be refused or, worse, silently reused, attaching a
     * reference booking to somebody else's turma on another site.
     */
    const clash = await one<{ id: string; facility_id: string }>(
      client,
      `SELECT id, facility_id FROM class_group
        WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
      [organizationId, turma.name],
    );

    if (clash !== null && clash.facility_id !== facilityId) {
      counts.skipped.push(`turma "${turma.name}" already exists on another site`);
      continue;
    }

    if (clash !== null) {
      turmaAt.set(turma.name, clash.id);
      continue;
    }

    const made = await one<{ id: string }>(
      client,
      `INSERT INTO class_group
         (organization_id, season_id, facility_id, pool_id, name, level_id,
          instructor_membership_id, capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        organizationId,
        season.id,
        facilityId,
        pools[turma.pool],
        turma.name,
        turma.level === null ? null : (levelAt.get(turma.level) ?? null),
        turma.staff === null ? null : (instructors[turma.staff % instructors.length] ?? null),
        turma.capacity,
      ],
    );

    turmaAt.set(turma.name, made!.id);
    counts.turmas += 1;
  }

  // ---------------------------------------------------------------- the bookings
  for (const block of WEEK) {
    const subject = block.subject ?? (block.turma !== undefined ? 'turma' : 'parceria');
    const poolId = pools[block.pool];

    const classGroupId = block.turma === undefined ? null : (turmaAt.get(block.turma) ?? null);
    const partnerGroupId = block.group === undefined ? null : (groupAt.get(block.group) ?? null);

    // A turma the seed skipped takes its bookings with it, rather than inserting
    // a subject-less row the CHECK would refuse anyway.
    if (subject === 'turma' && classGroupId === null) continue;
    if (subject === 'parceria' && partnerGroupId === null) continue;

    const dayGroup = block.weekday === 6 ? 'saturday' : block.weekday === 7 ? 'sunday' : 'weekday';
    const slotId = slotAt.get(`${dayGroup}:${block.start}`) ?? null;

    const already = await one<{ id: string }>(
      client,
      `SELECT id FROM class_schedule
        WHERE organization_id = $1 AND facility_id = $2 AND weekday = $3
          AND start_time = $4::time AND archived_at IS NULL
          AND coalesce(class_group_id, partner_group_id, '00000000-0000-0000-0000-000000000000')
              = coalesce($5::uuid, $6::uuid, '00000000-0000-0000-0000-000000000000')
          AND ($7::text <> 'manutencao' OR title = $8)`,
      [
        organizationId,
        facilityId,
        block.weekday,
        block.start,
        classGroupId,
        partnerGroupId,
        subject,
        block.title ?? null,
      ],
    );
    if (already) continue;

    const booking = await one<{ id: string }>(
      client,
      `INSERT INTO class_schedule
         (organization_id, facility_id, subject_type, class_group_id, partner_group_id,
          season_id, slot_id, weekday, start_time, duration_minutes,
          category_id, title, instructor_status)
       VALUES ($1, $2, $3::booking_subject, $4, $5, $6, $7, $8, $9::time, $10, $11, $12,
               $13::instructor_status)
       RETURNING id`,
      [
        organizationId,
        facilityId,
        subject,
        classGroupId,
        partnerGroupId,
        // A turma takes its season from its turma; everything else carries its
        // own — POOLSE-47's rule, and the CHECK enforces it.
        subject === 'turma' ? null : season.id,
        slotId,
        block.weekday,
        block.start,
        block.minutes,
        categoryAt.get(block.category) ?? null,
        block.title ?? null,
        block.status ?? 'to_define',
      ],
    );

    for (const position of block.lanes) {
      const laneId = laneAt.get(`${poolId}:${position}`);
      if (laneId === undefined) continue;
      await client.query(
        `INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [organizationId, booking!.id, laneId],
      );
    }

    counts.bookings += 1;
  }

  /*
   * And the dated sessions — criterion 5, QA 55.3.
   *
   * Four weeks rather than the whole season: enough for every weekday and a
   * Saturday to have happened, and short enough that the conflict rules are
   * exercised without generating nine months of rows into a developer's
   * database. **This is where the rules actually bite** — the lane exclusion and
   * the instructor rule live on `class_session`, not on the pattern, so a
   * schedule the model cannot express fails here rather than at insert.
   */
  const generated = await one<{ o_created: number }>(
    client,
    `SELECT * FROM generate_sessions($1, greatest($2::date, current_date),
                                     least($3::date, current_date + 28))`,
    [organizationId, season.starts_on, season.ends_on],
  );
  counts.sessions = generated?.o_created ?? 0;

  return counts;
}
