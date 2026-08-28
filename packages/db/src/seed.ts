/**
 * Demo data for a real-looking club.
 *
 * The schema has been provable since phase 0 and the screens have been building
 * for four backlog rounds, but neither can be *judged* against one student and
 * an empty register. This fills a working organization with the shape of an
 * actual Portuguese swimming school so the calendar, the age warnings, the
 * attendance flow and the vacation map can all be looked at rather than reasoned
 * about.
 *
 * Three rules it follows:
 *
 * **Additive, never destructive.** It seeds into the organization already there
 * rather than creating a parallel one, because there is no organization switcher
 * — a second org would be invisible or would hide the first. Nothing existing is
 * deleted or rewritten; every insert checks first.
 *
 * **Re-runnable.** Run it twice and the second run adds only what is missing.
 * Every entity is matched on a natural key, so a half-finished run can simply be
 * repeated.
 *
 * **Development only.** It refuses to run against anything that is not obviously
 * a local database, because seeding demo students into a customer's club would
 * be unrecoverable.
 *
 * Runs as the OWNER role, which bypasses RLS — the same reason the migration
 * runner does. It is writing across an organization it is not a member of.
 *
 *   pnpm db:seed
 */
import pg from 'pg';

const { Client } = pg;

/** Portuguese names, so the interface reads as it would for a real club. */
const STAFF = [
  { first: 'Marta', last: 'Ribeiro', roles: ['instructor'] },
  { first: 'Bruno', last: 'Carvalho', roles: ['instructor'] },
  { first: 'Sofia', last: 'Antunes', roles: ['instructor'] },
  { first: 'Hugo', last: 'Ferreira', roles: ['instructor', 'maintenance'] },
  { first: 'Inês', last: 'Rocha', roles: ['admin', 'instructor'] },
  { first: 'Pedro', last: 'Nogueira', roles: ['maintenance'] },
];

const FIRST_NAMES = [
  'Ana', 'João', 'Beatriz', 'Miguel', 'Carolina', 'Tomás', 'Matilde', 'Rodrigo',
  'Leonor', 'Afonso', 'Mariana', 'Duarte', 'Inês', 'Santiago', 'Francisca',
  'Gonçalo', 'Margarida', 'Martim', 'Alice', 'Diogo', 'Clara', 'Vicente',
  'Laura', 'Salvador', 'Benedita', 'Lourenço', 'Sara', 'Rafael', 'Madalena',
  'Guilherme', 'Íris', 'Simão', 'Núria', 'Xavier', 'Helena', 'Bernardo',
];

/**
 * The surname pool, including the shapes that break naive name handling —
 * POOLSE-32.
 *
 * The last five are here on purpose and should not be tidied away. Demo data
 * made only of single-word surnames makes every name rule look correct: it is
 * the particle, the compound and the hyphen that catch "the last word is the
 * surname", and a seeded club with none of them would have hidden that bug
 * rather than shown it. With them, `pnpm db:seed` produces a register where
 * "Maria da Silva" reads whole and files under S.
 *
 * `strip_accents` and the pt_pt collation get exercised by Gonçalves and
 * Álvares for the same reason.
 */
const LAST_NAMES = [
  'Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues',
  'Martins', 'Jesus', 'Sousa', 'Fernandes', 'Gonçalves', 'Gomes', 'Lopes',
  'Marques', 'Alves', 'Almeida', 'Ribeiro', 'Pinto', 'Carvalho', 'Álvares',
  'da Silva', 'dos Santos', 'de Sousa e Melo', 'Costa-Ribeiro', 'de Matos',
];

/**
 * Deterministic pseudo-randomness.
 *
 * A seed script that produces different data every run is one nobody can
 * describe a bug against — "the third student in Bebés" has to mean the same
 * person tomorrow. `Math.random` would also make the script's own idempotence
 * untestable.
 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const random = makeRandom(20260827);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/**
 * A stable 0–1 value for a given string.
 *
 * Used where the decision must be the same on every run — which sessions stay
 * unmarked, and how a given student was marked. The sequential generator above
 * cannot do that: its state depends on how many calls came before, so a second
 * run that creates fewer students reaches the attendance loop in a different
 * place and makes different choices. That is how re-running kept marking the
 * registers it had deliberately left alone.
 */
function stableUnit(key: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 100_000) / 100_000;
}

/**
 * A birth date for somebody who is exactly `months` old today.
 *
 * **Months, not years.** Level bounds have been months since POOLSE-06, and this
 * took years while its only caller passed `level.min` and `level.max` straight
 * in. A baby class bounded at 6 to 35 months therefore seeded six- to
 * thirty-five-*year*-olds, and the seed's whole purpose — students who fit their
 * level, so the aged-out flag means something when it fires — was inverted:
 * almost every student came out flagged.
 *
 * Counted backwards from today and then further back by up to 27 days, so the
 * monthly anniversary has always already passed. Jittering the day around a
 * fixed month — the obvious version — makes roughly half of them a month younger
 * than asked for, which at the bottom of a baby class is the difference between
 * eligible and not.
 */
function birthDateAged(months: number): string {
  const today = new Date();
  const anniversary = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth() - months,
    today.getUTCDate(),
  );

  // Earlier than the anniversary means older, never younger — up to one day
  // short of the next monthly anniversary.
  const born = new Date(anniversary - Math.floor(random() * 28) * 86_400_000);
  return born.toISOString().slice(0, 10);
}

/**
 * The senior level's bounds, in months — POOLSE-16.
 *
 * 60 to 100 years. The upper end is the ceiling the ticket raised the picker to;
 * the database has allowed 120 years since the months migration, so nothing here
 * is near a limit.
 */
const SENIOR_MIN_MONTHS = 60 * 12;
const SENIOR_MAX_MONTHS = 100 * 12;

interface Level {
  id: string;
  name: string;
  min: number | null;
  max: number | null;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');

  /*
   * The guard that makes this safe to leave in the repository.
   *
   * Demo students in a customer's club would be unrecoverable — there is no
   * "which of these forty children are real" query. A hostname check is crude
   * and it is exactly the crudeness that makes it hard to defeat by accident.
   */
  const local = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  if (!local && process.env['SEED_ANYWAY'] !== 'yes') {
    throw new Error(
      'Refusing to seed: DATABASE_URL does not look local. ' +
        'If you really mean it, set SEED_ANYWAY=yes.',
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query('BEGIN');

    const org = await one<{ id: string; name: string }>(
      client,
      `SELECT id, name FROM organization WHERE archived_at IS NULL ORDER BY created_at LIMIT 1`,
    );
    if (!org) {
      throw new Error(
        'No organization found. Sign up through the app first — the seed fills a club, it does not invent one.',
      );
    }
    console.log(`Seeding "${org.name}"`);

    const counts = {
      staff: 0,
      levels: 0,
      students: 0,
      enrollments: 0,
      attendance: 0,
      reposicoes: 0,
      vacations: 0,
      guardians: 0,
      skills: 0,
    };

    // ---------------------------------------------------------------------
    // A place, so the weather panel has coordinates to work with.
    // ---------------------------------------------------------------------
    const placed = await client.query(
      `UPDATE facility
          SET city = 'Aveiro', country_code = 'PT',
              latitude = 40.645750, longitude = -8.646430
        WHERE organization_id = $1 AND archived_at IS NULL AND city IS NULL`,
      [org.id],
    );
    if (placed.rowCount) console.log(`  facility: gave ${placed.rowCount} a city`);

    // ---------------------------------------------------------------------
    // Staff with names.
    //
    // The memberships already there are invitations nobody accepted, so every
    // instructor picker reads "Sem nome". These are people.
    // ---------------------------------------------------------------------
    for (const person of STAFF) {
      const clerkId = `seed:${person.first}.${person.last}`.toLowerCase();

      const existing = await one<{ id: string }>(
        client,
        `SELECT id FROM app_user WHERE clerk_user_id = $1`,
        [clerkId],
      );
      if (existing) continue;

      const user = await one<{ id: string }>(
        client,
        `INSERT INTO app_user (clerk_user_id, cached_email, cached_first_name,
                               cached_last_name, synced_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [
          clerkId,
          `${person.first}.${person.last}@exemplo.pt`.toLowerCase(),
          person.first,
          person.last,
        ],
      );

      const membership = await one<{ id: string }>(
        client,
        `INSERT INTO membership (organization_id, app_user_id, status)
         VALUES ($1, $2, 'active') RETURNING id`,
        [org.id, user!.id],
      );

      for (const role of person.roles) {
        await client.query(
          `INSERT INTO membership_role (organization_id, membership_id, role)
           VALUES ($1, $2, $3::member_role)`,
          [org.id, membership!.id, role],
        );
      }
      counts.staff += 1;
    }

    // ---------------------------------------------------------------------
    // Age ranges on the levels that have none.
    //
    // Only where absent: a range somebody set by hand is theirs.
    // ---------------------------------------------------------------------
    // Months — POOLSE-06. The baby class starts at six months, which is the
    // distinction whole years could not express and the reason the unit changed.
    const RANGES: Record<string, [number | null, number | null]> = {
      'natação para bebés': [6, 35],
      'nível a adaptação': [36, 71],
      'nível b autonomia': [60, 107],
      'nível c1 iniciação': [84, 155],
      'nível c2 aperfeiçoamento': [120, null],
      // 60 to 100 years — POOLSE-16. Present so the top of the range is
      // exercised by something rather than asserted in a test and never seen: a
      // level capped at 30 was the bug, and a demo tenant whose oldest student
      // is twelve would not have shown it.
      'hidroginástica sénior': [SENIOR_MIN_MONTHS, SENIOR_MAX_MONTHS],
    };

    /*
     * The senior level itself, if the club has not made one.
     *
     * Created rather than merely given a range, because unlike the others it is
     * not already in the operator's own list — and the students seeded below
     * need somewhere to be.
     */
    await client.query(
      `INSERT INTO student_level (organization_id, name, sort_order,
                                  min_age_months, max_age_months)
       SELECT $1, 'Hidroginástica Sénior',
              coalesce((SELECT max(sort_order) + 1 FROM student_level
                         WHERE organization_id = $1), 0),
              $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM student_level
           WHERE organization_id = $1
             AND lower(name) = 'hidroginástica sénior'
             AND archived_at IS NULL
        )`,
      [org.id, SENIOR_MIN_MONTHS, SENIOR_MAX_MONTHS],
    );

    const levels = await many<Level>(
      client,
      `SELECT id, name, min_age_months AS min, max_age_months AS max
         FROM student_level WHERE organization_id = $1 AND archived_at IS NULL
        ORDER BY sort_order`,
      [org.id],
    );

    for (const level of levels) {
      if (level.min !== null || level.max !== null) continue;
      const range = RANGES[level.name.toLowerCase()];
      if (!range) continue;

      await client.query(
        `UPDATE student_level SET min_age_months = $2, max_age_months = $3 WHERE id = $1`,
        [level.id, range[0], range[1]],
      );
      level.min = range[0];
      level.max = range[1];
      counts.levels += 1;
    }

    // ---------------------------------------------------------------------
    // Students.
    //
    // Aged to their level, so the age warnings are quiet by default and mean
    // something when they fire. Three deliberate exceptions, because a demo
    // where nothing is ever wrong cannot show what wrong looks like:
    //
    //   - about one in six has no birth date at all, which is the normal case
    //     after an import and must never raise a warning;
    //   - two are genuinely aged out of their level, so the register's flag has
    //     something to flag.
    // ---------------------------------------------------------------------
    const wanted = 42;
    const already = await one<{ n: string }>(
      client,
      `SELECT count(*) AS n FROM student WHERE organization_id = $1 AND archived_at IS NULL`,
      [org.id],
    );
    const toCreate = Math.max(0, wanted - Number(already?.n ?? 0));

    for (let index = 0; index < toCreate; index += 1) {
      const level = levels.length > 0 ? levels[index % levels.length]! : null;

      // Somewhere inside the level's range, or a plausible child if it has none.
      const low = level?.min ?? 6;
      const high = level?.max ?? Math.max(low + 4, 12);
      let age = low + Math.floor(random() * Math.max(1, high - low + 1));

      // The two who have outgrown their level.
      if (index === 3 || index === 17) age = (level?.max ?? 12) + 3;

      const hasBirthDate = index % 6 !== 0;

      await client.query(
        `INSERT INTO student (organization_id, first_name, last_name, birth_date,
                              level_id, contact_email, contact_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          org.id,
          pick(FIRST_NAMES),
          `${pick(LAST_NAMES)} ${pick(LAST_NAMES)}`,
          hasBirthDate ? birthDateAged(age) : null,
          level?.id ?? null,
          random() < 0.7 ? `encarregado${index}@exemplo.pt` : null,
          random() < 0.6 ? `9${Math.floor(10_000_000 + random() * 89_999_999)}` : null,
        ],
      );
      counts.students += 1;
    }

    /*
     * Competências, so the instructor grid has something to show — POOLSE-20.
     *
     * Real ones, in the order a Portuguese swimming school teaches them, with
     * thresholds on the two that genuinely need time in the water. A demo whose
     * skills are "Competência 1" through "Competência 5" shows the grid working
     * and nothing about what it is for.
     */
    const SKILLS: Record<string, [string, number | null, number | null][]> = {
      'natação para bebés': [
        ['Entrada na água ao colo', null, null],
        ['Flutuação com apoio', null, 4],
        ['Imersão da face', 3, 6],
        ['Deslize com apoio', null, null],
      ],
      'nível a adaptação': [
        ['Entrada autónoma', null, null],
        ['Imersão completa', null, 4],
        ['Flutuação ventral', 7, 6],
        ['Flutuação dorsal', 7, 6],
        ['Deslize ventral', null, null],
      ],
      'nível b autonomia': [
        ['Deslize dorsal', null, null],
        ['Pernada de crol', null, 8],
        ['Respiração lateral', 14, 10],
        ['Coordenação crol', 14, 12],
      ],
      'nível c1 iniciação': [
        ['Crol completo 25 m', 21, 12],
        ['Costas completo 25 m', 21, 12],
        ['Salto de partida', null, 4],
      ],
      'nível c2 aperfeiçoamento': [
        ['Bruços completo 25 m', 21, 12],
        ['Viragem de crol', null, 8],
        ['Mariposa — pernada', null, 8],
      ],
      'hidroginástica sénior': [
        ['Marcha aquática', null, null],
        ['Exercícios de mobilidade', null, null],
        ['Flutuação assistida', null, null],
      ],
    };

    for (const level of levels) {
      const wanted = SKILLS[level.name.toLowerCase()];
      if (wanted === undefined) continue;

      for (const [index, [name, minDays, minLessons]] of wanted.entries()) {
        const inserted = await client.query(
          `INSERT INTO skill (organization_id, level_id, name, sort_order,
                              min_days, min_lessons)
           SELECT $1, $2, $3, $4, $5, $6
            WHERE NOT EXISTS (
              SELECT 1 FROM skill
               WHERE level_id = $2 AND lower(name) = lower($3) AND archived_at IS NULL
            )`,
          [org.id, level.id, name, index, minDays, minLessons],
        );
        counts.skills += inserted.rowCount ?? 0;
      }
    }

    /*
     * Encarregados de educação, as people — POOLSE-17.
     *
     * Every minor gets one, and **siblings share theirs**, which is the case the
     * whole ticket is about: one woman, one record, three links. A seed that gave
     * each child its own guardian would demo the old shape perfectly and never
     * show what changed.
     *
     * Siblings are recognised by surname, which is how a club recognises them
     * too. Crude and deterministic — the same run produces the same families.
     */
    const minors = await many<{
      id: string;
      last_name: string;
      family_key: string;
      birth_date: Date | null;
    }>(
      client,
      /*
       * `name_sort_key(NULL, …)` is the family key: passing no given name leaves
       * the surname alone, without the given-name tiebreak that makes a full
       * sort key unique per person. "da Silva" and "Silva" both come back
       * "Silva", which is what makes two siblings one family.
       */
      `SELECT s.id, s.last_name, s.birth_date,
              name_sort_key(NULL, s.last_name) AS family_key
         FROM student s
        WHERE s.organization_id = $1
          AND s.archived_at IS NULL
          AND s.birth_date IS NOT NULL
          AND s.birth_date > current_date - interval '18 years'
          AND NOT EXISTS (
            SELECT 1 FROM guardian_link gl
             WHERE gl.student_id = s.id AND gl.archived_at IS NULL
          )
        ORDER BY name_sort_key(s.first_name, s.last_name) COLLATE pt_pt, s.id`,
      [org.id],
    );

    /** Surname → the guardian already made for that family, so siblings share one. */
    const family = new Map<string, string>();

    for (const minor of minors) {
      /*
       * Siblings share a guardian, and "siblings" means "filed under the same
       * surname" — POOLSE-32.
       *
       * This used to take the last whitespace token, which is the assumption the
       * ticket exists to remove: it filed "Rita de Sousa e Melo" under a family
       * called "Melo" and "Rui da Silva" under one called "Silva" only by
       * accident of word order. The database answers instead, so the demo
       * families group the same way the register files.
       */
      const surname = minor.family_key;
      let membershipId = family.get(surname);

      if (membershipId === undefined) {
        const given = pick(FIRST_NAMES);

        const created = await one<{ id: string }>(
          client,
          `INSERT INTO membership (organization_id, status, first_name, last_name,
                                   email, phone, tax_number)
           VALUES ($1, 'active', $2, $3, $4::citext, $5, $6)
           RETURNING id`,
          [
            org.id,
            given,
            surname,
            `${given}.${surname}${counts.guardians}@exemplo.pt`.toLowerCase(),
            `9${Math.floor(10_000_000 + random() * 89_999_999)}`,
            // A NIF for some but not all: the picker's match-by-NIF path and its
            // match-by-email path both need to be reachable in the demo.
            random() < 0.6 ? String(100_000_000 + Math.floor(random() * 899_999_999)) : null,
          ],
        );

        membershipId = created!.id;
        family.set(surname, membershipId);

        await client.query(
          `INSERT INTO membership_role (organization_id, membership_id, role)
           VALUES ($1, $2, 'guardian')`,
          [org.id, membershipId],
        );
        counts.guardians += 1;
      }

      await client.query(
        `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                                    relationship, is_primary)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT DO NOTHING`,
        [
          org.id,
          minor.id,
          membershipId,
          // Deterministic per family, so re-running does not reshuffle who is
          // whose mother. `stableUnit` is a hash, not the run's random stream.
          stableUnit(`rel:${surname}`) < 0.5 ? 'Mãe' : 'Pai',
        ],
      );
    }

    /*
     * A handful of seniors — POOLSE-16, criterion 4.
     *
     * Separate from the loop above because that one spreads students evenly
     * across every level, and evenly is exactly wrong here: a club running one
     * senior class has a dozen people in it, not two. Aged 60 to 85, inside the
     * level's bounds, so they read as an ordinary class rather than as a test
     * fixture.
     */
    const seniorLevel = await one<{ id: string }>(
      client,
      `SELECT id FROM student_level
        WHERE organization_id = $1
          AND lower(name) = 'hidroginástica sénior'
          AND archived_at IS NULL`,
      [org.id],
    );

    if (seniorLevel !== null) {
      const seniorsAlready = await one<{ n: string }>(
        client,
        `SELECT count(*) AS n FROM student
          WHERE organization_id = $1 AND level_id = $2 AND archived_at IS NULL`,
        [org.id, seniorLevel.id],
      );

      const seniorsToCreate = Math.max(0, 8 - Number(seniorsAlready?.n ?? 0));

      for (let index = 0; index < seniorsToCreate; index += 1) {
        const years = 60 + Math.floor(random() * 26);

        await client.query(
          `INSERT INTO student (organization_id, first_name, last_name, birth_date,
                                level_id, contact_email, contact_phone)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            org.id,
            pick(FIRST_NAMES),
            `${pick(LAST_NAMES)} ${pick(LAST_NAMES)}`,
            birthDateAged(years * 12),
            seniorLevel.id,
            // Their own address and their own phone. A seventy-year-old is not
            // somebody's child, and seeding an `encarregado@` address for them
            // would put the wrong idea in the demo.
            random() < 0.8 ? `socio${index}@exemplo.pt` : null,
            random() < 0.8 ? `9${Math.floor(10_000_000 + random() * 89_999_999)}` : null,
          ],
        );
        counts.students += 1;
      }
    }

    // ---------------------------------------------------------------------
    // Enrollments — fill each turma to about three quarters of capacity, and
    // put a few on the waiting list of the fullest one so that screen has
    // something in it.
    // ---------------------------------------------------------------------
    const groups = await many<{ id: string; name: string; capacity: number | null }>(
      client,
      `SELECT id, name, capacity FROM class_group
        WHERE organization_id = $1 AND archived_at IS NULL ORDER BY name`,
      [org.id],
    );

    const students = await many<{ id: string }>(
      client,
      `SELECT id FROM student WHERE organization_id = $1 AND archived_at IS NULL ORDER BY id`,
      [org.id],
    );

    let cursor = 0;
    for (const group of groups) {
      const capacity = group.capacity ?? 10;
      const target = Math.max(1, Math.floor(capacity * 0.75));

      const live = await one<{ n: string }>(
        client,
        `SELECT count(*) AS n FROM enrollment
          WHERE class_group_id = $1 AND status <> 'ended'`,
        [group.id],
      );
      const missing = Math.max(0, target - Number(live?.n ?? 0));

      for (let index = 0; index < missing && cursor < students.length; index += 1, cursor += 1) {
        // `ON CONFLICT DO NOTHING` against the partial unique index: a student
        // already in this turma is left alone rather than failing the run.
        const inserted = await client.query(
          `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT DO NOTHING`,
          [org.id, group.id, students[cursor]!.id],
        );
        counts.enrollments += inserted.rowCount ?? 0;
      }
    }

    // A waiting list on the first turma, so that state is visible somewhere.
    if (groups[0] && cursor < students.length) {
      for (let position = 1; position <= 3 && cursor < students.length; position += 1, cursor += 1) {
        const inserted = await client.query(
          `INSERT INTO enrollment (organization_id, class_group_id, student_id,
                                   status, waiting_position)
           VALUES ($1, $2, $3, 'waiting', $4)
           ON CONFLICT DO NOTHING`,
          [org.id, groups[0].id, students[cursor]!.id, position],
        );
        counts.enrollments += inserted.rowCount ?? 0;
      }
    }

    // ---------------------------------------------------------------------
    // Attendance on classes that have already happened.
    //
    // Only the last six weeks, and not every one of them: a club that has marked
    // every register perfectly is not a club, and the unmarked ones are what
    // make "3 of 12 marked" mean something on screen.
    // ---------------------------------------------------------------------
    const marker = await one<{ id: string }>(
      client,
      `SELECT m.id FROM membership m
        WHERE m.organization_id = $1 AND m.status = 'active'
        ORDER BY m.created_at LIMIT 1`,
      [org.id],
    );

    if (marker) {
      const past = await many<{ id: string; class_group_id: string }>(
        client,
        `SELECT cs.id, cs.class_group_id
           FROM class_session cs
          WHERE cs.organization_id = $1
            AND cs.status = 'scheduled'
            AND cs.starts_at < now()
            AND cs.starts_at > now() - interval '6 weeks'
            AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.class_session_id = cs.id)
          ORDER BY cs.starts_at`,
        [org.id],
      );

      for (const session of past) {
        // Four classes in five get marked. The fifth is the backlog every club
        // has, and the reason "unmarked" is reported separately from "absent".
        //
        // Keyed on the session id, so the one left unmarked today is the same
        // one left unmarked tomorrow.
        if (stableUnit(`mark:${session.id}`) > 0.8) continue;

        const roll = await many<{ student_id: string }>(
          client,
          `SELECT student_id FROM enrollment
            WHERE class_group_id = $1 AND status = 'active'`,
          [session.class_group_id],
        );

        for (const entry of roll) {
          const draw = stableUnit(`${session.id}:${entry.student_id}`);
          // Three states — POOLSE-13 removed late arrival entirely.
          const status = draw < 0.88 ? 'present' : draw < 0.96 ? 'absent' : 'excused';

          const inserted = await client.query(
            `INSERT INTO attendance (organization_id, class_session_id, student_id,
                                     status, recorded_by_membership_id, recorded_at)
             VALUES ($1, $2, $3, $4::attendance_status, $5,
                     (SELECT starts_at + interval '10 minutes' FROM class_session WHERE id = $2))
             ON CONFLICT DO NOTHING`,
            [org.id, session.id, entry.student_id, status, marker.id],
          );
          counts.attendance += inserted.rowCount ?? 0;
        }
      }
    }

    // ---------------------------------------------------------------------
    // Reposições — POOLSE-21.
    //
    // The demo club issues them, so the credit panel on a student record has
    // something in it and the settings screen is not describing a feature
    // nobody can see working.
    //
    // **The credits are minted by the trigger, not inserted here**, which is the
    // point: seeding them directly would be a second way for a credit to come
    // into existence and would prove nothing about the one that matters.
    //
    // Attendance is already seeded and `ON CONFLICT DO NOTHING`, so no new mark
    // arrives to fire the trigger on a database that has been seeded before.
    // Re-writing `status` to the value it already holds fires `UPDATE OF status`
    // and mints what is missing — idempotent, because the second pass finds
    // every excused mark already carrying a credit.
    // ---------------------------------------------------------------------
    await client.query(
      `UPDATE organization
          SET reposicao_enabled = true,
              reposicao_window_days = 60,
              reposicao_cap_per_season = 3,
              reposicao_backfill_only = false,
              reposicao_mode = 'request'
        WHERE id = $1`,
      [org.id],
    );

    /*
     * A known future absence, so the backfill-only rule has something to match.
     *
     * "She is away next week" is an ordinary thing for an office to be told, and
     * it is the *only* thing that makes criterion 4 usable: backfill-only offers
     * a place another student has vacated, and a place is not vacated until
     * somebody says so. Without a future absence in the data the rule looks
     * broken rather than strict.
     *
     * Seeded off by default all the same — see the settings write above. A club
     * evaluating the product should see reposições working before it meets the
     * rule that narrows them.
     */
    await client.query(
      `INSERT INTO attendance (organization_id, class_session_id, student_id,
                               status, recorded_by_membership_id)
       SELECT $1, cs.id, e.student_id, 'excused', $2
         FROM class_session cs
         JOIN enrollment e
           ON e.class_group_id = cs.class_group_id
          AND e.organization_id = cs.organization_id
          AND e.status = 'active'
        WHERE cs.organization_id = $1
          AND cs.status = 'scheduled'
          AND cs.starts_at > now()
          AND cs.starts_at < now() + interval '2 weeks'
        ORDER BY cs.starts_at, e.student_id
        LIMIT 2
       ON CONFLICT DO NOTHING`,
      [org.id, marker?.id ?? null],
    );

    const minted = await client.query(
      `UPDATE attendance a
          SET status = 'excused'
        WHERE a.organization_id = $1
          AND a.status = 'excused'
          AND NOT EXISTS (
            SELECT 1 FROM reposicao_credit c
             WHERE c.attendance_id = a.id AND c.archived_at IS NULL
          )`,
      [org.id],
    );
    counts.reposicoes += minted.rowCount ?? 0;

    // ---------------------------------------------------------------------
    // Leave, in each of the states the screens can show.
    // ---------------------------------------------------------------------
    const staff = await many<{ id: string }>(
      client,
      `SELECT m.id FROM membership m
         JOIN app_user u ON u.id = m.app_user_id
        WHERE m.organization_id = $1
          AND m.status = 'active'
          AND u.clerk_user_id LIKE 'seed:%'
        ORDER BY u.cached_first_name
        LIMIT 3`,
      [org.id],
    );

    /*
     * Asked of the seeded staff, not of the whole organization.
     *
     * The first version counted every request in the club, so one the operator
     * had made themselves while testing was enough to skip all three demo
     * states — and the screens stayed half-empty for the exact reason the seed
     * exists. Their own leave is none of this script's business either way.
     */
    const alreadyLeave = await one<{ n: string }>(
      client,
      `SELECT count(*) AS n
         FROM vacation_request vr
         JOIN membership m ON m.id = vr.membership_id
         JOIN app_user u ON u.id = m.app_user_id
        WHERE vr.organization_id = $1 AND u.clerk_user_id LIKE 'seed:%'`,
      [org.id],
    );

    if (Number(alreadyLeave?.n ?? 0) === 0 && staff.length >= 2) {
      const year = new Date().getUTCFullYear();

      // Approved: a week in the spring, for the map to draw.
      await requestLeave(client, org.id, staff[0]!.id, 'approved', staff[1]!.id, null, [
        `${year + 1}-04-12`,
        `${year + 1}-04-13`,
        `${year + 1}-04-14`,
        `${year + 1}-04-15`,
        `${year + 1}-04-16`,
      ]);

      // Pending: something for the approval queue to hold, overlapping the
      // approved week so the "who else is off" warning has a reason to appear.
      await requestLeave(client, org.id, staff[1]!.id, 'pending', null, null, [
        `${year + 1}-04-14`,
        `${year + 1}-04-15`,
      ]);

      // Rejected, with the reason the schema insists on.
      if (staff[2]) {
        await requestLeave(
          client,
          org.id,
          staff[2].id,
          'rejected',
          staff[0]!.id,
          'Semana de provas — precisamos de cobertura',
          [`${year + 1}-05-04`, `${year + 1}-05-05`],
        );
      }
      counts.vacations = 3;
    }

    await client.query('COMMIT');

    console.log('');
    console.log(`  staff added        ${counts.staff}`);
    console.log(`  levels given ages  ${counts.levels}`);
    console.log(`  students added     ${counts.students}`);
    console.log(`  enrollments        ${counts.enrollments}`);
    console.log(`  attendance marks   ${counts.attendance}`);
    console.log(`  reposições minted  ${counts.reposicoes}`);
    console.log(`  skills added       ${counts.skills}`);
    console.log(`  guardians linked   ${counts.guardians}`);
    console.log(`  leave requests     ${counts.vacations}`);
    console.log('');
    console.log('Done. Re-running only adds what is missing.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * A request and its days, in one go.
 *
 * The days are inserted before the status moves, because the trigger that
 * releases a refused request's days would otherwise archive them on the way in
 * and the rejected example would have nothing to show.
 */
async function requestLeave(
  client: pg.Client,
  organizationId: string,
  membershipId: string,
  status: 'pending' | 'approved' | 'rejected',
  decidedBy: string | null,
  note: string | null,
  days: string[],
): Promise<void> {
  const request = await one<{ id: string }>(
    client,
    `INSERT INTO vacation_request (organization_id, membership_id) VALUES ($1, $2) RETURNING id`,
    [organizationId, membershipId],
  );

  for (const day of days) {
    await client.query(
      `INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [organizationId, request!.id, membershipId, day],
    );
  }

  if (status === 'pending') return;

  await client.query(
    `UPDATE vacation_request
        SET status = $2::vacation_status, decided_at = now(),
            decided_by_membership_id = $3, decision_note = $4
      WHERE id = $1`,
    [request!.id, status, decidedBy, note],
  );
}

async function one<T extends pg.QueryResultRow>(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const { rows } = await client.query<T>(sql, params);
  return rows[0] ?? null;
}

async function many<T extends pg.QueryResultRow>(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await client.query<T>(sql, params);
  return rows;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
