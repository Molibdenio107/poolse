import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';

/**
 * A club that has been running for a few weeks — Rui, 28-10-2026.
 *
 * The base seed fills the people, the classes and the money; this fills the
 * three areas Rui found empty while testing:
 *
 *   - **Competição**: the FPN's age groups for the published season, three
 *     meets with results, and a championship's entry times that some swimmers
 *     already beat and some are close to.
 *   - **Manutenção, água, incidentes**: recurring tasks (some overdue), open
 *     and resolved requests, two weeks of water readings with two out of range,
 *     lab reports with one não conforme, and three incidents.
 *   - **Família / app**: messages sent, *Vou / Não vou* answers on the coming
 *     lessons, feedback on the past week's, and a family — Paula — with a
 *     pending invitation whose link is printed, so the app can be walked as a
 *     parent (sign up with the +clerk_test address; the code is 424242).
 *
 * Like the rest of the seed: additive, re-runnable, development only. Every
 * section checks for what it would add and skips what is there.
 */

export interface ActivityCounts {
  meets: number;
  results: number;
  entryTimes: number;
  tasks: number;
  requests: number;
  readings: number;
  labReports: number;
  incidents: number;
  messages: number;
  notices: number;
  feedback: number;
  /** The family's join link, printed for Rui; null when nothing was issued. */
  familyLink: string | null;
}

const FAMILY_EMAIL = 'familia+clerk_test@example.com';

/** The FPN's age groups (`FPN_AGE_GROUPS` in @poolse/rules), as ages; the seed package does not depend on rules. */
const FPN = [
  { name: 'Cadetes C', minAge: null, maxAge: 9 },
  { name: 'Cadetes B', minAge: 10, maxAge: 11 },
  { name: 'Cadetes A', minAge: 12, maxAge: 12 },
  { name: 'Infantis B', minAge: 13, maxAge: 13 },
  { name: 'Infantis A', minAge: 14, maxAge: 14 },
  { name: 'Juvenis B', minAge: 15, maxAge: 15 },
  { name: 'Juvenis A', minAge: 16, maxAge: 16 },
  { name: 'Juniores', minAge: 17, maxAge: 18 },
  { name: 'Seniores', minAge: 19, maxAge: null },
] as const;

/** A 50 m freestyle entry time per age (seconds), and how the other events scale from it. */
const BASE_50_FREE: Record<number, number> = { 10: 41, 11: 40, 12: 37.5, 13: 35, 14: 33, 15: 31.5, 16: 30.5 };
const EVENTS = [
  { stroke: 'freestyle', distance: 50, factor: 1 },
  { stroke: 'freestyle', distance: 100, factor: 2.2 },
  { stroke: 'backstroke', distance: 50, factor: 1.15 },
  { stroke: 'breaststroke', distance: 50, factor: 1.28 },
] as const;

/** Deterministic noise, so a re-run picks the same numbers. */
function wobble(seed: string, spread: number): number {
  const byte = createHash('sha256').update(seed).digest()[0]!;
  return (byte / 255 - 0.5) * 2 * spread;
}

function days(n: number, from: Date): Date {
  return new Date(from.getTime() + n * 86_400_000);
}

/** `encryptSensitive` in apps/api/src/sensitive/cipher.ts — the same format, so the API reads it. */
function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export async function seedActivity(
  client: pg.Client,
  organizationId: string,
  now: Date = new Date(),
): Promise<ActivityCounts> {
  const counts: ActivityCounts = {
    meets: 0,
    results: 0,
    entryTimes: 0,
    tasks: 0,
    requests: 0,
    readings: 0,
    labReports: 0,
    incidents: 0,
    messages: 0,
    notices: 0,
    feedback: 0,
    familyLink: null,
  };
  const org = organizationId;
  const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query<T>(sql, params)).rows;

  const facility = (await q<{ id: string }>(
    `SELECT id FROM facility WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
    [org],
  ))[0];
  if (facility === undefined) return counts;
  const pools = await q<{ id: string; name: string }>(
    `SELECT id, name FROM pool WHERE organization_id = $1 AND facility_id = $2 AND archived_at IS NULL ORDER BY created_at`,
    [org, facility.id],
  );
  const spaces = await q<{ id: string; name: string }>(
    `SELECT id, name FROM space WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at`,
    [org],
  );
  const staffWith = async (role: string): Promise<string[]> =>
    (await q<{ id: string }>(
      `SELECT m.id FROM membership m
         JOIN membership_role r ON r.membership_id = m.id AND r.archived_at IS NULL AND r.role = $2::member_role
        WHERE m.organization_id = $1 AND m.archived_at IS NULL AND m.support_grant_id IS NULL
        ORDER BY m.created_at`,
      [org, role],
    )).map((row) => row.id);
  const owner = (await staffWith('owner'))[0];
  if (owner === undefined) return counts;
  const maintenance = await staffWith('maintenance');
  const instructors = await staffWith('instructor');
  const fixer = maintenance[0] ?? owner;
  // Who a water alert reaches: owner, admin and maintenance, as 4.2 resolves them.
  const alertTo = (await q<{ email: string }>(
    `SELECT DISTINCT coalesce(u.cached_email, m.email)::text AS email
       FROM membership m
       JOIN membership_role r ON r.membership_id = m.id AND r.archived_at IS NULL
                             AND r.role IN ('owner', 'admin', 'maintenance')
       LEFT JOIN app_user u ON u.id = m.app_user_id
      WHERE m.organization_id = $1 AND m.archived_at IS NULL
        AND coalesce(u.cached_email, m.email) IS NOT NULL`,
    [org],
  )).map((row) => row.email);

  const season = (await q<{ id: string; ends_on: string }>(
    `SELECT id, to_char(ends_on, 'YYYY-MM-DD') AS ends_on FROM season
      WHERE organization_id = $1 AND status = 'published' AND archived_at IS NULL LIMIT 1`,
    [org],
  ))[0];

  // -------------------------------------------------------------------------
  // Competição
  // -------------------------------------------------------------------------
  if (season !== undefined) {
    const endYear = Number(season.ends_on.slice(0, 4));
    for (const group of FPN) {
      await client.query(
        `INSERT INTO federation_age_group (organization_id, season_id, name, born_from, born_to)
         SELECT $1, $2, $3, $4, $5
          WHERE NOT EXISTS (SELECT 1 FROM federation_age_group
                             WHERE organization_id = $1 AND season_id = $2 AND name = $3 AND archived_at IS NULL)`,
        [org, season.id, group.name, group.maxAge === null ? null : endYear - group.maxAge, group.minAge === null ? null : endYear - group.minAge],
      );
    }
    const groups = await q<{ id: string; name: string }>(
      `SELECT id, name FROM federation_age_group WHERE organization_id = $1 AND season_id = $2 AND archived_at IS NULL`,
      [org, season.id],
    );
    const groupFor = (age: number): string | undefined =>
      groups.find((g) => g.name === FPN.find((f) => (f.minAge ?? 0) <= age && age <= (f.maxAge ?? 99))?.name)?.id;

    // Swimmers: the club's children aged 10 to 16 at the season's end.
    const swimmers = await q<{ id: string; born: number }>(
      `SELECT id, extract(year FROM birth_date)::int AS born FROM student
        WHERE organization_id = $1 AND archived_at IS NULL AND anonymised_at IS NULL
          AND birth_date IS NOT NULL
          AND extract(year FROM birth_date)::int BETWEEN $2 - 16 AND $2 - 10
        ORDER BY last_name, first_name`,
      [org, endYear],
    );

    // A championship's entry times, inside this season.
    const standardName = 'Campeonato Regional de Inverno';
    let standard = (await q<{ id: string }>(
      `SELECT id FROM qualifying_standard WHERE organization_id = $1 AND season_id = $2 AND name = $3 AND archived_at IS NULL`,
      [org, season.id, standardName],
    ))[0];
    if (standard === undefined) {
      standard = (await q<{ id: string }>(
        `INSERT INTO qualifying_standard (organization_id, season_id, name, window_from, window_to)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [org, season.id, standardName, `${endYear - 1}-09-01`, `${endYear}-02-28`],
      ))[0]!;
      for (const [age, base] of Object.entries(BASE_50_FREE)) {
        const groupId = groupFor(Number(age));
        if (groupId === undefined) continue;
        for (const event of EVENTS) {
          const added = await client.query(
            `INSERT INTO qualifying_time (organization_id, season_id, standard_id, age_group_id, stroke, distance_m, course, time_ms)
             SELECT $1, $2, $3, $4, $5::swim_stroke, $6, 'scm', $7
              WHERE NOT EXISTS (SELECT 1 FROM qualifying_time WHERE standard_id = $3 AND age_group_id = $4
                                  AND stroke = $5::swim_stroke AND distance_m = $6 AND course = 'scm' AND archived_at IS NULL)`,
            [org, season.id, standard.id, groupId, event.stroke, event.distance, Math.round(base * event.factor * 1000)],
          );
          counts.entryTimes += added.rowCount ?? 0;
        }
      }
    }

    // Three meets this autumn: two official, one the club's own.
    const meets = [
      { name: 'Torneio de Abertura do Juncal', city: 'Lisboa', course: 'scm', on: `${endYear - 1}-09-27`, official: true, pace: 1.06 },
      { name: 'Meeting Distrital de Outono', city: 'Setúbal', course: 'lcm', on: `${endYear - 1}-10-11`, official: true, pace: 1.07 },
      { name: 'Festival Interno de Natação', city: 'Lisboa', course: 'scm', on: `${endYear - 1}-10-25`, official: false, pace: 1.0 },
    ] as const;
    for (const meet of meets) {
      if (new Date(`${meet.on}T12:00:00Z`) > now) continue;
      let meetId = (await q<{ id: string }>(
        `SELECT id FROM swim_meet WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, meet.name],
      ))[0]?.id;
      if (meetId !== undefined) continue;
      meetId = (await q<{ id: string }>(
        `INSERT INTO swim_meet (organization_id, name, city, course, starts_on, ends_on, official, created_by_membership_id)
         VALUES ($1, $2, $3, $4::swim_course, $5, $5, $6, $7) RETURNING id`,
        [org, meet.name, meet.city, meet.course, meet.on, meet.official, owner],
      ))[0]!.id;
      counts.meets += 1;
      for (const [index, swimmer] of swimmers.entries()) {
        const age = Math.min(16, Math.max(10, endYear - swimmer.born));
        const base = BASE_50_FREE[age]!;
        // Each swimmer swims three of the four events, rotating by meet.
        for (const [eventIndex, event] of EVENTS.entries()) {
          if ((eventIndex + index + meet.name.length) % 4 === 0) continue;
          const pace = meet.pace + wobble(`${swimmer.id}:${event.stroke}${event.distance}`, 0.07) + (meet.course === 'lcm' ? 0.03 : 0);
          await client.query(
            `INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on, course, meet_id, recorded_by_membership_id)
             VALUES ($1, $2, $3::swim_stroke, $4, $5, $6, $7::swim_course, $8, $9)`,
            [org, swimmer.id, event.stroke, event.distance, Math.round(base * event.factor * pace * 1000), meet.on, meet.course, meetId, owner],
          );
          counts.results += 1;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Manutenção
  // -------------------------------------------------------------------------
  const tasks = [
    { title: 'Limpar os pré-filtros das bombas', pool: 0, interval: 7, lastDone: 10 },
    { title: 'Retrolavagem dos filtros', pool: 0, interval: 3, lastDone: 1 },
    { title: 'Calibrar as sondas de pH e cloro', pool: 0, interval: 30, lastDone: null },
    { title: 'Verificar os doseadores de químicos', pool: 1, interval: 7, lastDone: 2 },
    { title: 'Aspirar o fundo com o robot', pool: 1, interval: 2, lastDone: 4 },
    { title: 'Inspecionar o equipamento de salvamento', pool: 2, interval: 30, lastDone: 20 },
  ];
  for (const [index, task] of tasks.entries()) {
    const pool = pools[task.pool] ?? pools[0];
    const exists = await q(`SELECT 1 FROM maintenance_task WHERE organization_id = $1 AND title = $2 AND archived_at IS NULL`, [org, task.title]);
    if (exists.length > 0) continue;
    const made = (await q<{ id: string }>(
      `INSERT INTO maintenance_task (organization_id, facility_id, pool_id, title, interval_days, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [org, facility.id, pool?.id ?? null, task.title, task.interval, index % 2 === 0 ? fixer : null],
    ))[0]!;
    counts.tasks += 1;
    if (task.lastDone !== null) {
      for (const back of [task.lastDone + task.interval * 2, task.lastDone + task.interval, task.lastDone]) {
        await client.query(
          `INSERT INTO maintenance_task_completion (organization_id, task_id, performed_at, performed_by)
           VALUES ($1, $2, $3, $4)`,
          [org, made.id, days(-back, now), fixer],
        );
      }
    }
  }

  const requests = [
    { type: 'fault', severity: 'high', text: 'Chuveiro 3 do balneário masculino sem água quente', ago: 1, resolved: false },
    { type: 'fault', severity: 'normal', text: 'Azulejo solto no segundo degrau da escada da piscina principal', ago: 3, resolved: false },
    { type: 'restock', severity: 'normal', text: 'Pastilhas de cloro abaixo do mínimo no armazém', ago: 0, resolved: false },
    { type: 'fault', severity: 'low', text: 'Lâmpada fundida por cima das bancadas', ago: 9, resolved: true },
    { type: 'fault', severity: 'normal', text: 'Cacifo 14 não fecha', ago: 12, resolved: true },
  ];
  for (const [index, request] of requests.entries()) {
    const exists = await q(`SELECT 1 FROM maintenance_request WHERE organization_id = $1 AND description = $2`, [org, request.text]);
    if (exists.length > 0) continue;
    const reporter = instructors[index % Math.max(1, instructors.length)] ?? owner;
    await client.query(
      `INSERT INTO maintenance_request (organization_id, facility_id, space_id, type, severity, description, reported_by, reported_at,
                                        status, resolved_by, resolved_at, resolution_note)
       VALUES ($1, $2, $3, $4::maintenance_request_type, $5::maintenance_severity, $6, $7, $8,
               $9::maintenance_request_status, $10, $11, $12)`,
      [
        org, facility.id, request.type === 'fault' && spaces.length > 0 ? spaces[index % spaces.length]!.id : null,
        request.type, request.severity, request.text, reporter, days(-request.ago, now),
        request.resolved ? 'resolved' : 'open',
        request.resolved ? fixer : null,
        request.resolved ? days(-request.ago + 2, now) : null,
        request.resolved ? 'Substituído.' : null,
      ],
    );
    counts.requests += 1;
  }

  // -------------------------------------------------------------------------
  // Água — two weeks, twice a day, two readings out of range
  // -------------------------------------------------------------------------
  for (const [poolIndex, pool] of pools.entries()) {
    const recent = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pool_analysis WHERE organization_id = $1 AND pool_id = $2 AND taken_at > $3`,
      [org, pool.id, days(-14, now)],
    );
    if ((recent[0]?.n ?? 0) > 6) continue;
    for (let day = 13; day >= 0; day -= 1) {
      for (const hour of [9, 17]) {
        const at = days(-day, now);
        at.setUTCHours(hour, 0, 0, 0);
        if (at > now) continue;
        const seed = `${pool.id}:${day}:${hour}`;
        let ph = 7.3 + wobble(`${seed}ph`, 0.15);
        let free = 1.2 + wobble(`${seed}cl`, 0.35);
        let combined = 0.25 + wobble(`${seed}cc`, 0.1);
        // Two excursions: the children's pool ran low yesterday afternoon, the main pool's pH is high today.
        if (poolIndex === 1 && day === 1 && hour === 17) free = 0.3;
        if (poolIndex === 0 && day === 0 && hour === 9) {
          ph = 8.2;
          combined = 0.7;
        }
        const analysis = (await q<{ id: string }>(
          `INSERT INTO pool_analysis (organization_id, pool_id, taken_at, recorded_by) VALUES ($1, $2, $3, $4) RETURNING id`,
          [org, pool.id, at, fixer],
        ))[0]!;
        const values: [string, number, string][] = [
          ['ph', Number(ph.toFixed(2)), 'pH'],
          ['free_chlorine', Number(free.toFixed(2)), 'ppm'],
          ['combined_chlorine', Number(Math.max(0, combined).toFixed(2)), 'ppm'],
          ['temperature', Number(((poolIndex === 1 ? 31 : 28) + wobble(`${seed}t`, 0.6)).toFixed(1)), '°C'],
        ];
        if (hour === 9) values.push(['total_alkalinity', Math.round(100 + wobble(`${seed}ta`, 15)), 'ppm']);
        for (const [metric, value, unit] of values) {
          await client.query(
            `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit) VALUES ($1, $2, $3::pool_metric, $4, $5)`,
            [org, analysis.id, metric, value, unit],
          );
        }
        counts.readings += 1;
        // What 4.2 would have recorded: who was told, and that it left.
        const excursion = (poolIndex === 1 && day === 1 && hour === 17) || (poolIndex === 0 && day === 0 && hour === 9);
        if (excursion) {
          await client.query(
            `INSERT INTO pool_analysis_alert (organization_id, pool_id, analysis_id, raised_at, metrics, recipients, delivered_at)
             VALUES ($1, $2, $3, $4::timestamptz, $5::pool_metric[], $6::text[], CASE WHEN cardinality($6::text[]) > 0 THEN $4::timestamptz END)`,
            [org, pool.id, analysis.id, at, poolIndex === 1 ? ['free_chlorine'] : ['ph', 'combined_chlorine'], alertTo],
          );
        }
      }
    }
  }

  // Lab reports: monthly, the last three months; the children's pool failed the latest.
  for (const [poolIndex, pool] of pools.entries()) {
    for (const monthsAgo of [3, 2, 1]) {
      const sampled = days(-monthsAgo * 30 + 3, now);
      const reference = `LAB-${sampled.toISOString().slice(0, 7)}-${poolIndex + 1}`;
      const exists = await q(`SELECT 1 FROM lab_result WHERE organization_id = $1 AND report_reference = $2`, [org, reference]);
      if (exists.length > 0) continue;
      const result = (await q<{ id: string }>(
        `INSERT INTO lab_result (organization_id, pool_id, sampled_at, laboratory, report_reference, sample_depth, recorded_by_membership_id)
         VALUES ($1, $2, $3, 'Laboratório Águas do Tejo', $4, 'surface', $5) RETURNING id`,
        [org, pool.id, sampled, reference, owner],
      ))[0]!;
      const failed = poolIndex === 1 && monthsAgo === 1;
      const values: [string, number, string][] = [
        ['colonies_37c', failed ? 140 : 12 + poolIndex * 5, 'ufc/mL'],
        ['total_coliforms', failed ? 4 : 0, 'ufc/100 mL'],
        ['e_coli', 0, 'ufc/100 mL'],
        ['pseudomonas_aeruginosa', failed ? 3 : 0, 'ufc/100 mL'],
        ['staphylococcus_coagulase_positive', 0, 'ufc/100 mL'],
      ];
      for (const [parameter, value, unit] of values) {
        await client.query(
          `INSERT INTO lab_result_value (organization_id, lab_result_id, parameter, value, unit) VALUES ($1, $2, $3::lab_parameter, $4, $5)`,
          [org, result.id, parameter, value, unit],
        );
      }
      if (failed) {
        await client.query(
          `INSERT INTO lab_result_alert (organization_id, pool_id, lab_result_id, raised_at, parameters, recipients, delivered_at)
           VALUES ($1, $2, $3, $4::timestamptz, ARRAY['pseudomonas_aeruginosa', 'total_coliforms']::lab_parameter[], $5::text[],
                   CASE WHEN cardinality($5::text[]) > 0 THEN $4::timestamptz END)`,
          [org, pool.id, result.id, sampled, alertTo],
        );
      }
      counts.labReports += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Incidentes — facts in columns, words encrypted as the API writes them
  // -------------------------------------------------------------------------
  const rawKey = process.env['SENSITIVE_DATA_KEY'];
  const key = rawKey === undefined ? null : Buffer.from(rawKey, 'base64');
  if (key !== null && key.length === 32) {
    const someStudent = (await q<{ id: string }>(
      `SELECT id FROM student WHERE organization_id = $1 AND archived_at IS NULL AND birth_date > now() - interval '12 years' ORDER BY created_at LIMIT 1`,
      [org],
    ))[0];
    const incidents = [
      { ago: 2, pool: 0, visitor: 'Joaquim Pires', emergency: false, what: 'Escorregou no cais junto à escada 2 ao sair da água.', injury: 'Escoriação no joelho direito.', aid: 'Limpeza e penso; voltou para casa pelo próprio pé.' },
      { ago: 6, pool: 1, visitor: null, emergency: false, what: 'Durante a aula queixou-se de tonturas e foi retirado da água.', injury: 'Sem lesões visíveis.', aid: 'Repouso e água; a mãe foi chamada e levou-o.' },
      { ago: 15, pool: 0, visitor: 'Teresa Gonçalves', emergency: true, what: 'Banhista com dificuldade respiratória na pista 6 durante a natação livre.', injury: 'Mal-estar súbito, consciente.', aid: 'Retirada pelo nadador-salvador, oxigénio, 112 chamado; seguiu de ambulância.' },
    ];
    for (const incident of incidents) {
      const at = days(-incident.ago, now);
      at.setUTCHours(17, 40, 0, 0);
      const exists = await q(`SELECT 1 FROM incident WHERE organization_id = $1 AND occurred_at = $2`, [org, at]);
      if (exists.length > 0) continue;
      const person = incident.visitor === null ? someStudent?.id ?? null : null;
      if (incident.visitor === null && person === null) continue;
      const made = (await q<{ id: string }>(
        `INSERT INTO incident (organization_id, facility_id, pool_id, occurred_at, student_id, visitor_name, emergency_called,
                               lifeguard_membership_id, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [org, facility.id, (pools[incident.pool] ?? pools[0])?.id ?? null, at, person, incident.visitor, incident.emergency, instructors[0] ?? null, owner],
      ))[0]!;
      await client.query(
        `INSERT INTO incident_detail (organization_id, incident_id, what_happened_encrypted, injury_encrypted, first_aid_encrypted)
         VALUES ($1, $2, $3, $4, $5)`,
        [org, made.id, encrypt(incident.what, key), encrypt(incident.injury, key), encrypt(incident.aid, key)],
      );
      counts.incidents += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Família — Paula, two children, and a link to sign up with
  // -------------------------------------------------------------------------
  const children = await q<{ id: string; first_name: string; last_name: string; class_group_id: string }>(
    `SELECT DISTINCT ON (s.id) s.id, s.first_name, s.last_name, e.class_group_id
       FROM student s
       JOIN enrollment e ON e.student_id = s.id AND e.organization_id = s.organization_id AND e.status = 'active'
       JOIN class_group cg ON cg.id = e.class_group_id AND cg.archived_at IS NULL
      WHERE s.organization_id = $1 AND s.archived_at IS NULL AND s.anonymised_at IS NULL
        AND s.birth_date > now() - interval '12 years'
      ORDER BY s.id, e.created_at
      LIMIT 2`,
    [org],
  );
  let paula = (await q<{ id: string }>(
    `SELECT id FROM membership WHERE organization_id = $1 AND email = $2::citext AND archived_at IS NULL`,
    [org, FAMILY_EMAIL],
  ))[0]?.id;
  if (paula === undefined && children.length > 0) {
    paula = (await q<{ id: string }>(
      `INSERT INTO membership (organization_id, status, first_name, last_name, email)
       VALUES ($1, 'invited', 'Paula', $2, $3::citext) RETURNING id`,
      [org, children[0]!.last_name, FAMILY_EMAIL],
    ))[0]!.id;
    await client.query(
      `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'guardian')`,
      [org, paula],
    );
    for (const child of children) {
      await client.query(
        `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
         VALUES ($1, $2, $3, 'Mãe', NOT EXISTS (SELECT 1 FROM guardian_link WHERE student_id = $2 AND is_primary AND archived_at IS NULL))`,
        [org, child.id, paula],
      );
    }
  }
  const stillInvited = paula === undefined
    ? []
    : await q(`SELECT 1 FROM membership WHERE id = $1 AND app_user_id IS NULL`, [paula]);
  if (paula !== undefined && stillInvited.length > 0) {
    // A fresh link each run: only the hash is stored, so an old one cannot be printed again.
    await client.query(
      `UPDATE invitation SET revoked_at = now()
        WHERE organization_id = $1 AND email = $2::citext AND accepted_at IS NULL AND revoked_at IS NULL`,
      [org, FAMILY_EMAIL],
    );
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id, invited_by_membership_id)
       VALUES ($1, $2::citext, ARRAY['guardian']::member_role[], $3, $4, $5, $6)`,
      [org, FAMILY_EMAIL, createHash('sha256').update(token, 'utf8').digest('hex'), days(7, now), paula, owner],
    );
    const origin = (process.env['WEB_ORIGIN'] ?? 'http://localhost:3000').split(',')[0]!.trim().replace(/\/$/, '');
    counts.familyLink = `${origin}/join?token=${encodeURIComponent(token)}`;
  }

  // Messages already sent, to the families of enrolled children.
  const messages = [
    { ago: 6, audience: 'organization', subject: 'Inscrições abertas para o Festival de Natal', body: 'O Festival de Natal é a 20 de dezembro. Inscrições na receção até 10 de dezembro. Todos os níveis podem participar.' },
    { ago: 3, audience: 'organization', subject: 'Piscina encerrada a 1 de novembro', body: 'No feriado de 1 de novembro a piscina está encerrada. As aulas desse dia não se realizam e não são descontadas.' },
    { ago: 1, audience: 'class_group', subject: 'Touca e óculos na próxima aula', body: 'Na próxima aula vamos treinar mergulhos. Tragam touca e óculos, por favor.' },
  ];
  for (const message of messages) {
    const exists = await q(`SELECT 1 FROM message WHERE organization_id = $1 AND subject = $2`, [org, message.subject]);
    if (exists.length > 0) continue;
    const turma = message.audience === 'class_group' ? children[0]?.class_group_id ?? null : null;
    if (message.audience === 'class_group' && turma === null) continue;
    const recipients = await q<{ student_id: string; guardian_id: string; student_name: string; name: string; email: string | null }>(
      `SELECT DISTINCT ON (gl.guardian_membership_id, s.id)
              s.id AS student_id, gl.guardian_membership_id AS guardian_id,
              s.first_name || ' ' || s.last_name AS student_name,
              coalesce(m.first_name || ' ' || m.last_name, m.email::text, 'Encarregado') AS name,
              m.email::text AS email
         FROM enrollment e
         JOIN student s ON s.id = e.student_id AND s.archived_at IS NULL
         JOIN guardian_link gl ON gl.student_id = s.id AND gl.archived_at IS NULL
         JOIN membership m ON m.id = gl.guardian_membership_id AND m.archived_at IS NULL
        WHERE e.organization_id = $1 AND e.status = 'active' AND ($2::uuid IS NULL OR e.class_group_id = $2)`,
      [org, turma],
    );
    const sentAt = days(-message.ago, now);
    const made = (await q<{ id: string }>(
      `INSERT INTO message (organization_id, audience, class_group_id, subject, body, sent_by_membership_id, sent_at, address_count)
       VALUES ($1, $2::message_audience, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [org, message.audience, turma, message.subject, message.body, owner, sentAt, new Set(recipients.map((r) => r.email).filter(Boolean)).size],
    ))[0]!;
    for (const recipient of recipients) {
      await client.query(
        `INSERT INTO message_recipient (organization_id, message_id, student_id, guardian_membership_id, student_name, name, email, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [org, made.id, recipient.student_id, recipient.guardian_id, recipient.student_name, recipient.name, recipient.email, recipient.email === null ? null : sentAt],
      );
    }
    counts.messages += 1;
  }

  // *Vou / Não vou* on the coming week's lessons, from the families.
  const coming = await q<{ session_id: string; student_id: string; guardian_id: string }>(
    `SELECT cs.id AS session_id, e.student_id, gl.guardian_membership_id AS guardian_id
       FROM class_session cs
       JOIN enrollment e ON e.class_group_id = cs.class_group_id AND e.organization_id = cs.organization_id AND e.status = 'active'
       JOIN guardian_link gl ON gl.student_id = e.student_id AND gl.archived_at IS NULL
      WHERE cs.organization_id = $1 AND cs.status <> 'cancelled' AND cs.class_group_id IS NOT NULL
        AND cs.starts_at BETWEEN $2 AND $3
      ORDER BY cs.starts_at, e.student_id`,
    [org, days(0.1, now), days(7, now)],
  );
  for (const [index, row] of coming.entries()) {
    const paulas = row.guardian_id === paula;
    if (!paulas && index % 5 !== 0) continue;
    const added = await client.query(
      `INSERT INTO session_notice (organization_id, class_session_id, student_id, going, answered_by_membership_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [org, row.session_id, row.student_id, paulas ? index % 2 === 1 : index % 3 === 0, row.guardian_id],
    );
    counts.notices += added.rowCount ?? 0;
  }

  // What the families said about the past week's lessons.
  const taught = await q<{ session_id: string; student_id: string; guardian_id: string }>(
    `SELECT DISTINCT ON (a.class_session_id, a.student_id)
            a.class_session_id AS session_id, a.student_id, gl.guardian_membership_id AS guardian_id
       FROM attendance a
       JOIN class_session cs ON cs.id = a.class_session_id
       JOIN guardian_link gl ON gl.student_id = a.student_id AND gl.archived_at IS NULL
      WHERE a.organization_id = $1 AND a.status = 'present' AND cs.status <> 'cancelled'
        AND cs.starts_at + make_interval(mins => cs.duration_minutes) BETWEEN $2 AND $3`,
    [org, days(-6, now), now],
  );
  const comments = [
    'Adorou a aula, veio para casa a falar dos mergulhos.',
    'Gostou muito do professor.',
    null,
    'Achou a água um pouco fria.',
    'Está muito mais confiante na água.',
    null,
    'Teve medo na parte funda, mas correu bem.',
  ];
  for (const [index, row] of taught.slice(0, 18).entries()) {
    const added = await client.query(
      `INSERT INTO lesson_feedback (organization_id, class_session_id, student_id, mood, comment, author_membership_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [org, row.session_id, row.student_id, [5, 4, 5, 3, 4, 5, 2][index % 7], comments[index % comments.length], row.guardian_id],
    );
    counts.feedback += added.rowCount ?? 0;
  }

  return counts;
}
