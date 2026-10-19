import { after, before, test } from 'node:test';
import { MeetsController } from '../meets/meets.controller.js';
import { QualifyingController } from '../qualifying/qualifying.controller.js';
import { InvoicesController } from '../billing/invoices.controller.js';
import assert from 'node:assert/strict';
import { ArchiveController } from '../archive/archive.controller.js';
import { ActivityController } from '../activity/activity.controller.js';
import { SupportGrantsController } from '../support/support.controller.js';
import {
  ClassesController,
  TimetableController,
} from '../classes/classes.controller.js';
import {
  CalendarController,
  ClosuresController,
  SessionsCalendarController,
  StudentCalendarController,
} from '../classes/sessions.controller.js';
import { SeasonsController } from '../classes/seasons.controller.js';
import { SkillsController } from '../classes/skills.controller.js';
import { DashboardController } from '../dashboard/dashboard.controller.js';
import { FacilitiesController } from '../facilities/facilities.controller.js';
import { GridController } from '../facilities/grid.controller.js';
import { OccupancyController } from '../facilities/occupancy.controller.js';
import { PartnersController } from '../facilities/partners.controller.js';
import { SlotsController } from '../facilities/slots.controller.js';
import { AttachmentsController } from '../files/attachments.controller.js';
import { FilesController } from '../files/files.controller.js';
import { InventoryController } from '../inventory/inventory.controller.js';
import { InvitationsController } from '../invitations/invitations.controller.js';
import { MaintenanceController } from '../maintenance/maintenance.controller.js';
import { FacilityIncidentsController, IncidentsController } from '../safety/incidents.controller.js';
import {
  LifeguardDutiesController,
  LifeguardPeriodsController,
  LifeguardRosterController,
} from '../safety/roster.controller.js';
import { SpacesController } from '../spaces/spaces.controller.js';
import { LeadsController, RegistrationSettingsController } from '../leads/leads.controller.js';
import { LabResultsController } from '../facilities/lab-results.controller.js';
import { ComplaintsSettingsController, RegulationsController } from '../facilities/regulations.controller.js';
import { RecordsController } from '../students/records.controller.js';
import {
  FamilyController,
  GuardiansController,
  PeopleDedupController,
  PeopleSearchController,
  StudentsController,
} from '../students/students.controller.js';
import { StudentFeesController } from '../billing/fees.controller.js';
import { VacationsController } from '../vacations/vacations.controller.js';
import { PlacesController, WeatherController } from '../weather/weather.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import type { MemberRole } from '../tenant/roles.js';

/**
 * Role probe — security review, 12-10-2026, inverted into a regression test.
 *
 * There is no global role guard: every handler calls `requireRole` or refuses
 * per row. The review found 48 handlers that did neither, and a member holding
 * only `guardian` (linked to nobody) or only `student` could read the student
 * register, every parent's contacts and staff NIFs and addresses, and write
 * skill sign-offs and leave requests. Each test below pins the refusal that
 * replaced a leak, and the positive case the fix must not break: a linked
 * guardian still reads their own child, a student still reads themselves.
 *
 * The fixture is one club with: an admin with phone, NIF and address; two
 * instructors (Ana teaches the turma; Beatriz teaches nothing and is on
 * approved *medical* leave on the lesson day); a maintenance member; two
 * students with birth dates, contact e-mails and NIFs (Alice, and Bruno, whose
 * row is the student-role member's own); Marta, linked to Alice; a turma with
 * both enrolled, a weekly slot and a lesson next week; a partner with a contact
 * and a priced agreement; a lost-and-found item naming Alice. The probers are
 * Zeca (guardian, unlinked) and Bruno (student role).
 *
 * Run: cd apps/api && node --env-file-if-exists=../../.env --test dist/security/role-probe.integration.test.js
 */

interface Fixture {
  aliceId: string;
  brunoStudentId: string;
  martaId: string;
  adminId: string;
  instructorId: string;
  awayInstructorId: string;
  groupId: string;
  sessionId: string;
  /** The session's day — a week out, so outside the calendar's default window. */
  sessionOn: string;
  poolId: string;
  partnerId: string;
  skillId: string;
  unlinkedGuardianId: string;
  studentMemberId: string;
  maintenanceId: string;
}

const ADMIN_NIF = '245678905';
const ALICE_NIF = '123456789';

async function seed(tenant: ScratchTenant): Promise<Fixture> {
  const org = tenant.organizationId;

  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
    [org, tenant.facilityId],
  );

  const adminId = await addMember(tenant, 'Carla', 'Admin', ['admin']);
  await tenant.sql(
    `UPDATE membership SET phone = '912345678', tax_number = $2, address = 'Rua Privada 1, Lisboa'
      WHERE id = $1`,
    [adminId, ADMIN_NIF],
  );

  const instructorId = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const awayInstructorId = await addMember(tenant, 'Beatriz', 'Doente', ['instructor']);
  const maintenanceId = await addMember(tenant, 'Mario', 'Manutencao', ['maintenance']);

  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name) VALUES ($1, 'Iniciados') RETURNING id`,
    [org],
  );
  const [skill] = await tenant.sql<{ id: string }>(
    `INSERT INTO skill (organization_id, level_id, name, sort_order)
     VALUES ($1, $2, 'Respiração lateral', 1) RETURNING id`,
    [org, level!.id],
  );

  // Two students with personal data.
  const [alice] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email,
                          contact_phone, tax_number, notes, level_id)
     VALUES ($1, 'Alice', 'Privada', '2016-03-04', 'alice.family@example.test',
             '934000111', $2, 'Nota interna sobre a Alice', $3) RETURNING id`,
    [org, ALICE_NIF, level!.id],
  );

  const studentMemberId = await addMember(tenant, 'Bruno', 'Aluno', ['student']);
  const [bruno] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email,
                          membership_id, level_id)
     VALUES ($1, 'Bruno', 'Aluno', '2001-07-08', 'bruno@example.test', $2, $3) RETURNING id`,
    [org, studentMemberId, level!.id],
  );

  // Alice's mother — the linked guardian. Not the prober.
  const martaId = await addMember(tenant, 'Marta', 'Mae', ['guardian']);
  await tenant.sql(
    `UPDATE membership SET phone = '961111222', address = 'Rua da Alice 2' WHERE id = $1`,
    [martaId],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
     VALUES ($1, $2, $3, 'mãe')`,
    [org, alice!.id, martaId],
  );

  // The prober: a guardian linked to nobody.
  const unlinkedGuardianId = await addMember(tenant, 'Zeca', 'Estranho', ['guardian']);

  const { id: groupId } = await actingAs(tenant, { roles: ['owner'] }, async () =>
    new ClassesController().create({
      name: 'Iniciados A',
      poolId: pool!.id,
      lane: 1,
      levelId: level!.id,
      instructorMembershipId: instructorId,
    }),
  );

  // A weekly slot, so the timetable has something to say.
  await actingAs(tenant, { roles: ['owner'] }, async () =>
    new ClassesController().schedule(groupId, {
      weekday: '3',
      startTime: '18:00',
      durationMinutes: '45',
    }),
  );

  for (const studentId of [alice!.id, bruno!.id]) {
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [org, groupId, studentId],
    );
  }

  const [session] = await tenant.sql<{ id: string; occurs_on: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
     VALUES ($1, $2, $3, now() + interval '7 days', 45, (now() + interval '7 days')::date)
     RETURNING id, occurs_on::text`,
    [org, groupId, pool!.id],
  );

  // Beatriz is on approved medical leave that day.
  const [leave] = await tenant.sql<{ id: string }>(
    `INSERT INTO vacation_request (organization_id, membership_id, kind, reason, status,
                                   decided_at, decided_by_membership_id)
     VALUES ($1, $2, 'medical', 'Cirurgia ao joelho', 'approved', now(), $3) RETURNING id`,
    [org, awayInstructorId, tenant.ownerMembershipId],
  );
  await tenant.sql(
    `INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
     VALUES ($1, $2, $3, $4::date)`,
    [org, leave!.id, awayInstructorId, session!.occurs_on],
  );

  // A partner with a contact and a priced agreement.
  const partners = new PartnersController();
  const partnerId = await actingAs(tenant, { roles: ['owner'] }, async () => {
    const { id } = await partners.create(tenant.facilityId, {
      name: 'ES D. Dinis',
      type: 'escola',
      nif: '501234560',
      color: '#67a6b6',
    });
    await partners.addPartnerContact(id, {
      name: 'Diretor Contacto',
      email: 'diretor@escola.example.test',
      phone: '939999888',
    });
    await partners.recordAgreement(id, {
      startDate: '2026-09-01',
      endDate: '2027-07-31',
      billingModel: 'por_hora_pista',
      unitPrice: '14.375',
      vatRate: '23',
      paymentPeriod: 'mensal',
    });

    await new InventoryController().recordFound({
      facilityId: tenant.facilityId,
      description: 'Óculos azuis',
      locationFound: 'Balneário',
      studentId: alice!.id,
    });
    return id;
  });

  return {
    aliceId: alice!.id,
    brunoStudentId: bruno!.id,
    martaId,
    adminId,
    instructorId,
    awayInstructorId,
    groupId,
    sessionId: session!.id,
    sessionOn: session!.occurs_on,
    poolId: pool!.id,
    partnerId,
    skillId: skill!.id,
    unlinkedGuardianId,
    studentMemberId,
    maintenanceId,
  };
}

/** Both non-staff probers, so every refusal is checked twice. */
function probers(f: Fixture): { label: string; membershipId: string; roles: MemberRole[] }[] {
  return [
    { label: 'unlinked guardian', membershipId: f.unlinkedGuardianId, roles: ['guardian'] },
    { label: 'student', membershipId: f.studentMemberId, roles: ['student'] },
  ];
}

let tenantRef: ScratchTenant;
let fixture: Fixture;
let release: () => void = () => {};
let done: Promise<void> = Promise.resolve();

/*
 * One tenant for the whole file: the fixture is expensive. The tenant is held
 * open until every test has run, then torn down, then the pools close.
 */
before(async () => {
  await new Promise<void>((resolveReady, rejectReady) => {
    done = withScratchTenant(async (tenant) => {
      tenantRef = tenant;
      fixture = await seed(tenant);
      resolveReady();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }).catch((error: unknown) => rejectReady(error));
  });
});

after(async () => {
  release();
  await done;
  await closeHarness();
});

async function asEach(fn: (who: { label: string }) => Promise<void>): Promise<void> {
  for (const who of probers(fixture)) {
    await actingAs(tenantRef, { membershipId: who.membershipId, roles: who.roles }, () => fn(who));
  }
}

function as<T>(membershipId: string, roles: MemberRole[], fn: () => Promise<T>): Promise<T> {
  return actingAs(tenantRef, { membershipId, roles }, fn);
}

/** expectStatus, with the route named so a failure says which one opened up. */
async function refused(route: string, status: number, fn: () => Promise<unknown>): Promise<void> {
  try {
    await expectStatus(fn, status);
  } catch (error) {
    throw new Error(`${route}: ${(error as Error).message}`);
  }
}

const NO_SUCH_ID = '00000000-0000-0000-0000-000000000000';

// --------------------------------------------------------------------------
// Personal data — staff routes refuse non-staff
// --------------------------------------------------------------------------

test('people, register and guardian lists refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    await refused('GET people-search', 403, () => new PeopleSearchController().search('Carla'));
    await refused('GET people/duplicate', 403, () =>
      new PeopleDedupController().duplicate(ADMIN_NIF),
    );
    await refused('GET students', 403, () => new StudentsController().list());
    await refused('GET guardians', 403, () => new GuardiansController().list());
    await refused('GET people-search/:marta/students', 403, () =>
      new PeopleSearchController().students(fixture.martaId),
    );
  });
});

test('people-search/:membershipId/students answers for the caller themselves', async () => {
  await as(fixture.martaId, ['guardian'], async () => {
    const { students } = await new PeopleSearchController().students(fixture.martaId);
    assert.deepEqual(
      students.map((s) => s.id),
      [fixture.aliceId],
      'Marta sees her own child',
    );
  });
});

test('rosters, skills grid and stand-in list refuse non-staff (403)', async () => {
  await asEach(async () => {
    await refused('GET class-groups', 403, () => new ClassesController().list());
    await refused('GET class-groups/:id', 403, () => new ClassesController().one(fixture.groupId));
    await refused('GET skills/turma/:id', 403, () => new SkillsController().grid(fixture.groupId));
    await refused('GET sessions/:id/stand-in', 403, () =>
      new SessionsCalendarController().standInOptions(fixture.sessionId),
    );
  });
});

test("a stranger's child is not there: students/:id and its timetable, calendar, progression (404)", async () => {
  await asEach(async () => {
    await refused('GET students/:alice', 404, () => new StudentsController().one(fixture.aliceId));
    await refused('GET students/:alice/timetable', 404, () =>
      new TimetableController().read(fixture.aliceId),
    );
    await refused('GET students/:alice/calendar', 404, () =>
      new StudentCalendarController().read(fixture.aliceId),
    );
    await refused('GET students/:alice/progression', 404, () =>
      new RecordsController().read(fixture.aliceId),
    );
  });
});

test("a linked guardian reads their own child, and not another's", async () => {
  await as(fixture.martaId, ['guardian'], async () => {
    const alice = await new StudentsController().one(fixture.aliceId);
    assert.equal(alice.id, fixture.aliceId);
    assert.equal(alice.canViewSensitive, false, 'the medical record stays behind its own guard');

    const timetable = await new TimetableController().read(fixture.aliceId);
    assert.ok(timetable.entries.length > 0, "her child's timetable");

    const calendar = await new StudentCalendarController().read(
      fixture.aliceId,
      fixture.sessionOn,
      fixture.sessionOn,
    );
    assert.ok(calendar.sessions.length > 0, "her child's calendar");

    const progression = await new RecordsController().read(fixture.aliceId);
    assert.ok(Array.isArray(progression.records), "her child's progression");

    await refused('GET students/:bruno as Marta', 404, () =>
      new StudentsController().one(fixture.brunoStudentId),
    );
    await refused('GET students/:bruno/timetable as Marta', 404, () =>
      new TimetableController().read(fixture.brunoStudentId),
    );
    await refused('GET students/:bruno/calendar as Marta', 404, () =>
      new StudentCalendarController().read(fixture.brunoStudentId),
    );
    await refused('GET students/:bruno/progression as Marta', 404, () =>
      new RecordsController().read(fixture.brunoStudentId),
    );
  });
});

test('a student reads their own record, timetable, calendar and progression', async () => {
  await as(fixture.studentMemberId, ['student'], async () => {
    const me = await new StudentsController().one(fixture.brunoStudentId);
    assert.equal(me.id, fixture.brunoStudentId);

    const timetable = await new TimetableController().read(fixture.brunoStudentId);
    assert.ok(timetable.entries.length > 0, 'own timetable');

    const calendar = await new StudentCalendarController().read(
      fixture.brunoStudentId,
      fixture.sessionOn,
      fixture.sessionOn,
    );
    assert.ok(calendar.sessions.length > 0, 'own calendar');

    const progression = await new RecordsController().read(fixture.brunoStudentId);
    assert.ok(Array.isArray(progression.records), 'own progression');
  });
});

// --------------------------------------------------------------------------
// Partners — money and third-party contacts
// --------------------------------------------------------------------------

test('partners: staff only; contract money only for owner and admin', async () => {
  await asEach(async () => {
    await refused('GET partners/:id', 403, () => new PartnersController().detail(fixture.partnerId));
    await refused('GET facilities/:id/partners', 403, () =>
      new PartnersController().list(tenantRef.facilityId),
    );
    await refused('GET facilities/:id/partners/bookable', 403, () =>
      new PartnersController().bookable(tenantRef.facilityId),
    );
  });

  await as(fixture.instructorId, ['instructor'], async () => {
    const detail = await new PartnersController().detail(fixture.partnerId);
    assert.equal(detail.name, 'ES D. Dinis', 'an instructor still reads the partnership');
    assert.equal(detail.agreement, null, 'but not the contract');

    const page = await new PartnersController().list(tenantRef.facilityId);
    assert.ok(page.items.length > 0, 'an instructor still sees the partners');
    assert.equal(page.items[0]!.contractedCents, null, 'but not what they pay');
    assert.equal(page.items[0]!.billingModel, null, 'nor how they are billed');
  });

  await as(tenantRef.ownerMembershipId, ['owner'], async () => {
    const detail = await new PartnersController().detail(fixture.partnerId);
    assert.equal(Number(detail.agreement?.unitPrice), 14.375, 'the owner still reads the contract');
  });
});

// --------------------------------------------------------------------------
// Writes — refused, and nothing written
// --------------------------------------------------------------------------

async function count(table: 'skill_progress' | 'vacation_request'): Promise<number> {
  const [row] = await tenantRef.sql<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return row!.n;
}

test('POST skills/mark: refused for non-staff and for an instructor outside the turma; nothing written', async () => {
  const before = await count('skill_progress');

  await as(fixture.studentMemberId, ['student'], async () => {
    await refused('POST skills/mark as student (own row)', 403, () =>
      new SkillsController().mark({
        marks: [
          {
            studentId: fixture.brunoStudentId,
            skillId: fixture.skillId,
            state: 'attained',
            overrideReason: 'eu acho que sim',
          },
        ],
      }),
    );
  });

  await as(fixture.unlinkedGuardianId, ['guardian'], async () => {
    await refused('POST skills/mark as unlinked guardian', 403, () =>
      new SkillsController().mark({
        marks: [
          { studentId: fixture.aliceId, skillId: fixture.skillId, state: 'attained', overrideReason: 'x' },
        ],
      }),
    );
  });

  // Beatriz teaches nothing, so Alice is not hers to mark.
  await as(fixture.awayInstructorId, ['instructor'], async () => {
    await refused('POST skills/mark as an instructor who does not teach Alice', 403, () =>
      new SkillsController().mark({
        marks: [{ studentId: fixture.aliceId, skillId: fixture.skillId, state: 'attained', overrideReason: 'x' }],
      }),
    );
  });

  assert.equal(await count('skill_progress'), before, 'no mark was written');
});

test('vacations: mine, request and withdraw refuse non-staff; nothing written', async () => {
  const before = await count('vacation_request');

  await asEach(async ({ label }) => {
    await refused(`GET vacations/mine as ${label}`, 403, () => new VacationsController().mine());
    await refused(`POST vacations/requests as ${label}`, 403, () =>
      new VacationsController().request({ days: ['2027-02-01'], kind: 'vacation' }),
    );
    await refused(`POST vacations/requests/:id/withdraw as ${label}`, 403, () =>
      new VacationsController().withdraw(NO_SUCH_ID),
    );
  });

  assert.equal(await count('vacation_request'), before, 'no leave request was written');
});

// --------------------------------------------------------------------------
// Club-internal operational data — staff only
// --------------------------------------------------------------------------

test('operational reads refuse non-staff (403)', async () => {
  await asEach(async () => {
    const fac = tenantRef.facilityId;
    await refused('GET calendar', 403, () => new CalendarController().read());
    await refused('GET facilities/:id/grid', 403, () => new GridController().read(fac));
    await refused('GET facilities/:id/occupancy', 403, () => new OccupancyController().read(fac));
    await refused('GET facilities/:id/slots', 403, () => new SlotsController().list(fac));
    await refused('GET facilities/pools/:id', 403, () =>
      new FacilitiesController().pool(fixture.poolId),
    );
    await refused('GET facilities/:id', 403, () => new FacilitiesController().one(fac));
    await refused('GET maintenance/facilities/:id/tasks', 403, () =>
      new MaintenanceController().list(fac),
    );
    await refused('GET maintenance/tasks/:id', 403, () => new MaintenanceController().one(NO_SUCH_ID));
    await refused('GET maintenance/tasks/:id/completions', 403, () =>
      new MaintenanceController().history(NO_SUCH_ID),
    );
    await refused('GET spaces', 403, () => new SpacesController().list(fac));
    await refused('GET spaces/:id', 403, () => new SpacesController().detail(NO_SUCH_ID));
    await refused('GET inventory', 403, () => new InventoryController().list(fac));
    await refused('GET inventory/export', 403, () => new InventoryController().exportAll(fac));
    await refused('GET inventory/lost-and-found', 403, () =>
      new InventoryController().lostAndFound(fac),
    );
    await refused('GET places', 403, () => new PlacesController().search('Lisboa'));
    // 13-10-2026 sweep: the one handler that had no role check.
    await refused('GET weather', 403, () => new WeatherController().current('38.7', '-9.1'));
    await refused('GET incidents/people', 403, () =>
      new IncidentsController().people('student', 'Alice'),
    );
  });
});

test('places is owner/admin: an instructor is refused too', async () => {
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('GET places as instructor', 403, () => new PlacesController().search('Lisboa'));
  });
});

test('operational reads still answer staff: maintenance reads the calendar, grid, spaces and lost-and-found', async () => {
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    const calendar = await new CalendarController().read();
    assert.ok(Array.isArray(calendar.sessions));
    assert.ok(await new GridController().read(tenantRef.facilityId));
    const spaces = await new SpacesController().list(tenantRef.facilityId);
    assert.ok(Array.isArray(spaces.items));
    const found = await new InventoryController().lostAndFound(tenantRef.facilityId);
    assert.ok(Array.isArray(found.items));
  });
});

test('incidents/people gives maintenance names and nothing else', async () => {
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    const { people } = await new IncidentsController().people('student', 'Alice');
    const alice = people.find((p) => p.id === fixture.aliceId);
    assert.ok(alice, 'Alice is found by name');
    for (const person of people) {
      assert.deepEqual(Object.keys(person).sort(), ['id', 'name'], 'no contact, NIF or birth date');
    }

    const staff = await new IncidentsController().people('staff', 'Carla');
    for (const person of staff.people) {
      assert.deepEqual(Object.keys(person).sort(), ['id', 'name'], 'the staff picker is names only too');
    }
  });
});

// --------------------------------------------------------------------------
// Intended open — reads a family legitimately needs
// --------------------------------------------------------------------------

test('intended open: seasons, closures and dashboard still answer non-staff', async () => {
  await asEach(async ({ label }) => {
    const seasons = await new SeasonsController().list();
    assert.ok(seasons.seasons.length > 0, `${label}: seasons`);

    const closures = await new ClosuresController().list();
    assert.ok(Array.isArray(closures.closures), `${label}: closures`);

    const dashboard = await new DashboardController().read();
    assert.ok(dashboard, `${label}: dashboard (registry decides)`);
  });
});

test('meets refuse a guardian and a student (403) — POOLSE-81', async () => {
  await asEach(async () => {
    const meets = new MeetsController();
    await refused('GET meets', 403, () => meets.list());
    await refused('GET meets/:id', 403, () => meets.one(NO_SUCH_ID));
    await refused('POST meets/import', 403, () => meets.import({}));
    await refused('POST meets/:id/archive', 403, () => meets.archive(NO_SUCH_ID));
  });
});

test('invoice reminders refuse a guardian and a student (403) — POOLSE-86', async () => {
  await asEach(async () => {
    const invoices = new InvoicesController();
    await refused('POST facilities/:id/invoices/reminders', 403, () =>
      invoices.remind(tenantRef.facilityId, { invoiceIds: [NO_SUCH_ID] }),
    );
  });
});

test('qualifying standards refuse a guardian and a student (403) — POOLSE-85', async () => {
  await asEach(async () => {
    const q = new QualifyingController();
    await refused('GET qualifying', 403, () => q.read());
    await refused('POST qualifying/age-groups', 403, () => q.addAgeGroup({}));
    await refused('PUT qualifying/age-groups/:id', 403, () => q.editAgeGroup(NO_SUCH_ID, {}));
    await refused('POST qualifying/age-groups/:id/archive', 403, () => q.removeAgeGroup(NO_SUCH_ID));
    await refused('POST qualifying/standards', 403, () => q.addStandard({}));
    await refused('GET qualifying/standards/:id', 403, () => q.standard(NO_SUCH_ID));
    await refused('PUT qualifying/standards/:id', 403, () => q.editStandard(NO_SUCH_ID, {}));
    await refused('POST qualifying/standards/:id/archive', 403, () => q.removeStandard(NO_SUCH_ID));
    await refused('PUT qualifying/standards/:id/times/:ageGroupId', 403, () =>
      q.setTimes(NO_SUCH_ID, NO_SUCH_ID, {}),
    );
    await refused('GET qualifying/standards/:id/board', 403, () => q.board(NO_SUCH_ID));
    await refused('POST qualifying/standards/:id/times/import', 403, () => q.importTimes(NO_SUCH_ID, {}));
  });
});

test('closure writes refuse a guardian and a student (403) — POOLSE-84', async () => {
  await asEach(async () => {
    const closures = new ClosuresController();
    const body = { startsOn: '2027-03-09', endsOn: '2027-03-09', reason: 'x', facilityId: tenantRef.facilityId };
    await refused('POST closures', 403, () => closures.create(body));
    await refused('GET closures/impact', 403, () =>
      closures.impact('2027-03-09', '2027-03-09', tenantRef.facilityId),
    );
    await refused('PUT closures/:id', 403, () => closures.update(NO_SUCH_ID, body));
    await refused('POST closures/:id/archive', 403, () => closures.remove(NO_SUCH_ID));
  });
});

// --------------------------------------------------------------------------
// Protected — controls that held before the review
// --------------------------------------------------------------------------

test('protected: invitations and role grants refuse non-staff', async () => {
  await asEach(async () => {
    await expectStatus(
      () => new InvitationsController().create({ email: 'x@example.test', roles: ['guardian'] }),
      403,
    );
    await expectStatus(
      () => new PeopleDedupController().grant(fixture.martaId, { role: 'guardian' }),
      403,
    );
    await expectStatus(
      () => new PeopleDedupController().revoke(fixture.martaId, 'guardian'),
      403,
    );
  });
});

// POOLSE-70 — the incident book and the lifeguard roster, added with the
// endpoints (the rule since the review of 12 October 2026).
test('incidents and the lifeguard roster refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const fac = tenantRef.facilityId;
    await refused('GET facilities/:id/incidents', 403, () => new FacilityIncidentsController().list(fac));
    await refused('POST facilities/:id/incidents', 403, () =>
      new FacilityIncidentsController().record(fac, { occurredAt: '2026-01-01T10:00', visitorName: 'X', whatHappened: 'x' }),
    );
    await refused('GET facilities/:id/lifeguard-roster', 403, () =>
      new LifeguardRosterController().read(fac, '2026-01-05', '7'),
    );
    await refused('GET lifeguard-roster/on-duty', 403, () =>
      new LifeguardRosterController().onDuty(fixture.poolId, '2026-01-05T10:00'),
    );
    await refused('POST facilities/:id/lifeguard-roster', 403, () =>
      new LifeguardRosterController().add(fac, {}),
    );
    await refused('POST incidents/:id/export', 403, () =>
      new IncidentsController().export('00000000-0000-0000-0000-000000000000'),
    );
    await refused('POST facilities/:id/lifeguard-roster/periods', 403, () =>
      new LifeguardRosterController().addPeriod(fac, {}),
    );
    await refused('POST lifeguard-periods/:id/end', 403, () =>
      new LifeguardPeriodsController().end('00000000-0000-0000-0000-000000000000', {}),
    );
    await refused('POST lifeguard-duties/:id/archive', 403, () =>
      new LifeguardDutiesController().archive('00000000-0000-0000-0000-000000000000'),
    );
  });
});

// File storage (12 October 2026) — every write is the office's; reading is
// GET /files/:id's rule by purpose, proven in files.integration.test.ts.
test('file uploads and attachments refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const fac = tenantRef.facilityId;
    await refused('POST files', 403, () => new FilesController().upload('logo', 'x.png', Buffer.from('x')));
    await refused('POST facilities/:id/photos', 403, () =>
      new AttachmentsController().addFacilityPhoto(fac, { fileId: NO_SUCH_ID }),
    );
    await refused('DELETE facilities/:id/photos/:id', 403, () =>
      new AttachmentsController().removeFacilityPhoto(fac, NO_SUCH_ID),
    );
    await refused('POST pools/:id/photos', 403, () =>
      new AttachmentsController().addPoolPhoto(fixture.poolId, { fileId: NO_SUCH_ID }),
    );
    await refused('DELETE pools/:id/photos/:id', 403, () =>
      new AttachmentsController().removePoolPhoto(fixture.poolId, NO_SUCH_ID),
    );
    await refused('PUT insurance-policies/:id/document', 403, () =>
      new AttachmentsController().policyDocument(fac, NO_SUCH_ID, { fileId: null }),
    );
    await refused('PUT partners/:id/agreement/document', 403, () =>
      new AttachmentsController().agreementDocument(NO_SUCH_ID, { fileId: null }),
    );
    await refused('PUT qualifications/:id/document', 403, () =>
      new AttachmentsController().qualificationDocument(NO_SUCH_ID, { fileId: NO_SUCH_ID }),
    );
    await refused('PUT settings/logo', 403, () => new AttachmentsController().setLogo({ fileId: null }));
  });
});

test('the archive bin refuses a guardian and a student (403)', async () => {
  await asEach(async () => {
    const archive = new ArchiveController();
    await refused('GET archive', 403, () => archive.list());
    await refused('GET archive/actors', 403, () => archive.actors());
    await refused('POST archive/:id/restore', 403, () => archive.restore(NO_SUCH_ID));
  });
});

test('activity and revert refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const activity = new ActivityController();
    await refused('GET students/:id/activity', 403, () => activity.student(NO_SUCH_ID));
    await refused('GET class-groups/:id/activity', 403, () => activity.classGroup(NO_SUCH_ID));
    await refused('POST activity/:entryId/revert', 403, () => activity.revert(NO_SUCH_ID, {}));
  });
});

test('support access refuses a guardian and a student (403)', async () => {
  await asEach(async () => {
    const support = new SupportGrantsController();
    await refused('GET support-grants', 403, () => support.list());
    await refused('POST support-grants', 403, () => support.open({ hours: 24 }));
    await refused('POST support-grants/:id/revoke', 403, () => support.revoke(NO_SUCH_ID));
    await refused('GET support-grants/status', 403, () => support.status());
    await refused('GET support-grants/activity', 403, () => support.activity());
    await refused('GET support-grants/requests', 403, () => support.requests());
    await refused('POST support-grants/requests/:id/approve', 403, () =>
      support.approve(NO_SUCH_ID, { hours: 24 }),
    );
    await refused('POST support-grants/requests/:id/decline', 403, () => support.decline(NO_SUCH_ID));
  });
});

test('the pre-registration queue refuses a guardian and a student (403)', async () => {
  await asEach(async () => {
    const leads = new LeadsController();
    await refused('GET leads', 403, () => leads.list());
    await refused('GET leads/trial-options', 403, () => leads.options(NO_SUCH_ID));
    await refused('GET leads/:id', 403, () => leads.one(NO_SUCH_ID));
    await refused('POST leads/:id/waitlist', 403, () => leads.waitlist(NO_SUCH_ID, { classGroupId: NO_SUCH_ID }));
    await refused('POST leads/:id/convert', 403, () => leads.convert(NO_SUCH_ID, { classGroupId: NO_SUCH_ID }));
    await refused('POST leads/:id/trial', 403, () => leads.trial(NO_SUCH_ID, { sessionId: NO_SUCH_ID }));
    await refused('POST leads/:id/dismiss', 403, () => leads.dismiss(NO_SUCH_ID, { reason: 'x' }));
    const settings = new RegistrationSettingsController();
    await refused('GET settings/registration', 403, () => settings.read());
    await refused('PUT settings/registration', 403, () => settings.update({ slug: 'abc', open: true }));
  });
});

test('lab results refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const lab = new LabResultsController();
    await refused('GET facilities/pools/:poolId/lab-results', 403, () => lab.list(NO_SUCH_ID));
    await refused('POST facilities/pools/:poolId/lab-results', 403, () =>
      lab.record(NO_SUCH_ID, { sampledAt: new Date().toISOString(), values: [] }),
    );
    await refused('POST facilities/pools/:poolId/lab-results/:id/archive', 403, () =>
      lab.archive(NO_SUCH_ID, NO_SUCH_ID),
    );
  });
});

test('regulations and the complaints setting refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const regulations = new RegulationsController();
    await refused('GET facilities/:id/regulations', 403, () => regulations.list(NO_SUCH_ID));
    await refused('POST facilities/:id/regulations', 403, () =>
      regulations.publish(NO_SUCH_ID, { effectiveFrom: '2026-10-13', body: 'x' }),
    );
    await refused('POST facilities/:id/regulations/:id/archive', 403, () =>
      regulations.archive(NO_SUCH_ID, NO_SUCH_ID),
    );
    const complaints = new ComplaintsSettingsController();
    await refused('GET settings/complaints', 403, () => complaints.read());
    await refused('PUT settings/complaints', 403, () => complaints.update({ regime: 'private' }));
  });
});

// --------------------------------------------------------------------------
// A family's own record, fees and plans — 15 October 2026 (Rui)
// --------------------------------------------------------------------------

test('a lesson plan is read by its own class, and by nobody else outside staff', async () => {
  // Bruno is enrolled in the turma: he reads it, without who wrote it.
  await as(fixture.studentMemberId, ['student'], async () => {
    const plan = await new SessionsCalendarController().plan(fixture.sessionId);
    assert.equal(plan.canEdit, false);
    assert.equal(plan.updatedBy, null, 'a family is not told who wrote it');
    assert.equal(plan.previous, null);
  });
  // Marta's Alice is enrolled too.
  await as(fixture.martaId, ['guardian'], async () => {
    assert.ok(await new SessionsCalendarController().plan(fixture.sessionId));
  });
  // Zeca has no child in that class.
  await as(fixture.unlinkedGuardianId, ['guardian'], async () => {
    await refused('GET sessions/:id/plan as a stranger', 404, () =>
      new SessionsCalendarController().plan(fixture.sessionId),
    );
  });
  // Staff read every plan.
  for (const [id, roles] of [
    [fixture.instructorId, ['instructor']],
    [fixture.maintenanceId, ['maintenance']],
  ] as const) {
    await as(id, [...roles], async () => {
      const plan = await new SessionsCalendarController().plan(fixture.sessionId);
      assert.ok(plan.sessionId === fixture.sessionId);
    });
  }
});

test("a guardian reads their own child's record, without the club's notes", async () => {
  await as(fixture.martaId, ['guardian'], async () => {
    const alice = await new StudentsController().one(fixture.aliceId);
    assert.equal(alice.familyView, true);
    assert.equal(alice.notes, null, 'internal notes stay with the club');
    assert.equal(alice.canViewSensitive, false);
    assert.equal(alice.canViewProgress, true);
    const own = alice.guardians.find((g) => g.membershipId === fixture.martaId);
    assert.equal(own?.phone, '961111222', 'her own entry is whole');

    const { students } = await new FamilyController().mine();
    assert.deepEqual(students.map((s) => s.id), [fixture.aliceId]);

    await refused('GET students/:bruno as Marta', 404, () =>
      new StudentsController().one(fixture.brunoStudentId),
    );
  });
  // Staff still get the whole record.
  await as(fixture.instructorId, ['instructor'], async () => {
    const alice = await new StudentsController().one(fixture.aliceId);
    assert.equal(alice.familyView, false);
    assert.equal(alice.notes, 'Nota interna sobre a Alice');
  });
});

test('a student finds their own record through /family', async () => {
  await as(fixture.studentMemberId, ['student'], async () => {
    const { students } = await new FamilyController().mine();
    assert.deepEqual(students, [
      { id: fixture.brunoStudentId, name: students[0]!.name, relationship: null, self: true },
    ]);
  });
  await as(fixture.unlinkedGuardianId, ['guardian'], async () => {
    assert.deepEqual((await new FamilyController().mine()).students, []);
  });
});

test('a family reads what it owes; the instructor who teaches them does not', async () => {
  await as(fixture.martaId, ['guardian'], async () => {
    const fees = await new StudentFeesController().list(fixture.aliceId);
    assert.equal(fees.familyView, true);
    assert.deepEqual(fees.categories, [], 'the club\'s concessions are the office\'s');
    assert.deepEqual(fees.seasonCharges, []);
    assert.ok(fees.lines.every((line) => line.discountReason === null));
    await refused('GET students/:bruno/fees as Marta', 404, () =>
      new StudentFeesController().list(fixture.brunoStudentId),
    );
  });
  await as(fixture.studentMemberId, ['student'], async () => {
    assert.equal((await new StudentFeesController().list(fixture.brunoStudentId)).familyView, true);
  });
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('GET students/:id/fees as instructor', 403, () =>
      new StudentFeesController().list(fixture.aliceId),
    );
  });
  await as(fixture.adminId, ['admin'], async () => {
    assert.equal((await new StudentFeesController().list(fixture.aliceId)).familyView, false);
  });
});

test('maintenance is offered neither the register nor the skills grid; an instructor is', async () => {
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    assert.equal((await new CalendarController().read()).canTakeRegister, false);
    assert.equal((await new ClassesController().one(fixture.groupId)).canMarkSkills, false);
  });
  await as(fixture.instructorId, ['instructor'], async () => {
    assert.equal((await new CalendarController().read()).canTakeRegister, true);
    assert.equal((await new ClassesController().one(fixture.groupId)).canMarkSkills, true);
  });
});

test('a partner\'s agreement is not offered to staff who are sent none', async () => {
  await as(fixture.instructorId, ['instructor'], async () => {
    const partner = await new PartnersController().detail(fixture.partnerId);
    assert.equal(partner.canManage, false);
    assert.equal(partner.agreement, null);
  });
});
