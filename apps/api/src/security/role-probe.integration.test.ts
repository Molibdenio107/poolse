import { AiReadsController } from '../ai/ai-reads.controller.js';
import { AI_READERS } from '@poolse/rules';
import { after, before, test } from 'node:test';
import { MeetsController } from '../meets/meets.controller.js';
import { MeetInboxController } from '../meets/meet-inbox.controller.js';
import { SubscriptionController } from '../billing/subscription.controller.js';
import { QualifyingController } from '../qualifying/qualifying.controller.js';
import { InvoicesController } from '../billing/invoices.controller.js';
import { OwnEmailPreferenceController } from '../notifications/email-preferences.controller.js';
import pg from 'pg';
import assert from 'node:assert/strict';
import { ArchiveController } from '../archive/archive.controller.js';
import { ActivityController } from '../activity/activity.controller.js';
import { CoverRequestsController, LessonRequestsController } from '../classes/lesson-requests.controller.js';
import { AppViewController } from '../app-view/app-view.controller.js';
import { SupportGrantsController } from '../support/support.controller.js';
import {
  ClassesController,
  RecentAttendanceController,
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
import { QualificationsController } from '../staff/qualifications.controller.js';
import { FilesController } from '../files/files.controller.js';
import { SensitiveController } from '../sensitive/sensitive.controller.js';
import { InventoryController } from '../inventory/inventory.controller.js';
import { CostsController } from '../costs/costs.controller.js';
import { FamilyProgressController } from '../students/family-progress.controller.js';
import { InvitationsController } from '../invitations/invitations.controller.js';
import {
  FamilyInvitationsBulkController,
  StudentInvitationsController,
} from '../students/family-invitations.controller.js';
import { BoletimController, FpnSettingsController, StudentDocumentsController } from '../students/documents.controller.js';
import { DocumentTemplatesController } from '../students/boletim-template.controller.js';
import { MedicalExamsController } from '../students/medical-exams.controller.js';
import { MaintenanceController } from '../maintenance/maintenance.controller.js';
import { FacilityIncidentsController, IncidentsController } from '../safety/incidents.controller.js';
import {
  LifeguardDutiesController,
  LifeguardPeriodsController,
  LifeguardRosterController,
} from '../safety/roster.controller.js';
import { SpacesController } from '../spaces/spaces.controller.js';
import { SettingsController } from '../organizations/organizations.controller.js';
import { LeadsController, RegistrationSettingsController } from '../leads/leads.controller.js';
import { LabResultsController } from '../facilities/lab-results.controller.js';
import { EnergyInvoicesController } from '../energy/invoices.controller.js';
import { ComplaintsSettingsController, RegulationsController } from '../facilities/regulations.controller.js';
import { RecordsController } from '../students/records.controller.js';
import {
  AdvancementController,
  FamilyController,
  GuardiansController,
  LevelsController,
  PeopleDedupController,
  PeopleSearchController,
  StudentsController,
  StudentSportLevelController,
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
import { AppController } from '../app/app.controller.js';
import { StaffController } from '../staff/staff.controller.js';
import { CompensationController, SalariesController } from '../staff/compensation.controller.js';
import { FeedbackController } from '../feedback/feedback.controller.js';
import { NoticesController } from '../notices/notices.controller.js';
import { PushController } from '../push/push.controller.js';
import { AttentionController } from '../attention/attention.controller.js';
import { ShellController } from '../shell/shell.controller.js';
import { AppAvisosController, AvisosController } from '../messages/avisos.controller.js';
import { StudentMessagesController } from '../messages/student-messages.controller.js';
import { MedicalExamScheduleController } from '../students/medical-exam-schedule.controller.js';
import { StaffNotesController } from '../staff-notes/staff-notes.controller.js';
import { PersonCategoriesController } from '../billing/person-categories.controller.js';
import { PassProductsController, ReceptionController } from '../reception/passes.controller.js';
import { FeeCategoriesController } from '../billing/categories.controller.js';

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
     -- Next week's Wednesday, the turma's own day: "a week from today" was a
     -- Sunday every Sunday, and a leave day may not be one (vacation_day CHECK).
     -- At 07:00, clear of the 18:00 lesson the pattern already generated.
     VALUES ($1, $2, $3, date_trunc('week', now()) + interval '9 days 7 hours', 45,
             (date_trunc('week', now()) + interval '9 days')::date)
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
    await refused('POST students/:id/birth-date/confirm', 403, () =>
      new StudentsController().confirmBirthDate(NO_SUCH_ID, {}),
    );
    await refused('GET guardians', 403, () => new GuardiansController().list());
    await refused('GET people-search/:marta/students', 403, () =>
      new PeopleSearchController().students(fixture.martaId),
    );
  });
});

test('the advancement queue, its outlook, Propor and the mode refuse a guardian and a student (403)', async () => {
  // POOLSE-112. The queue was never probed; the three new routes join it here.
  await asEach(async () => {
    await refused('GET transfer-proposals', 403, () => new AdvancementController().list());
    await refused('GET transfer-proposals/outlook', 403, () => new AdvancementController().outlook());
    await refused('POST transfer-proposals/propose-by-age', 403, () =>
      new AdvancementController().proposeByAge({}),
    );
    await refused('PATCH levels/advancement-mode', 403, () =>
      new LevelsController().advancementMode({ mode: 'apply' }),
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
    await refused('GET class-groups/clashes', 403, () => new ClassesController().clashes());
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
    await refused('GET students/:alice/attendance-recent', 404, () =>
      new RecentAttendanceController().read(fixture.aliceId),
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
    await refused('GET students/:bruno/attendance-recent as Marta', 404, () =>
      new RecentAttendanceController().read(fixture.brunoStudentId),
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
    await refused('POST partners/groups/:id/bookings', 403, () =>
      new PartnersController().bookDays(NO_SUCH_ID, { weekdays: [1], startTime: '10:00', durationMinutes: 45, laneIds: [] }),
    );
    await refused('DELETE partners/groups/bookings/:id', 403, () => new PartnersController().removeDay(NO_SUCH_ID));
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

async function count(
  table: 'skill_progress' | 'vacation_request' | 'pool' | 'playing_area',
): Promise<number> {
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
    // A family's own progress: a stranger's child is a 404, and the office's read refuses.
    await refused('GET app/progress/:id', 404, () => new FamilyProgressController().read(fixture.aliceId));
    await refused('GET app/progress/:id/times', 404, () => new FamilyProgressController().times(fixture.aliceId));
    await refused('POST app/progress/:id/times', 404, () => new FamilyProgressController().addTime(fixture.aliceId, {}));
    await refused('POST app/progress/:id/favourite', 404, () => new FamilyProgressController().favourite(fixture.aliceId, {}));
    await refused('POST app/progress/:id/times/:r/archive', 404, () => new FamilyProgressController().archiveTime(fixture.aliceId, NO_SUCH_ID));
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
    await refused('POST facilities/:id/pools', 403, () =>
      new FacilitiesController().addPool(fac, { name: 'Tanque', kind: 'indoor' }),
    );
    // POOLSE-124: the role check comes before the sport is even read.
    await refused('POST facilities/:id/playing-areas', 403, () =>
      new FacilitiesController().addPlayingArea(fac, { sportId: 'tennis', name: 'Campo' }),
    );
    await refused('POST facilities/playing-areas/:id/archive', 403, () =>
      new FacilitiesController().archivePlayingArea(NO_SUCH_ID),
    );
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
    // POOLSE-182: the ledger is the office's; recording is staff's.
    await refused('GET costs/months', 403, () => new CostsController().months('2026-01-01', '2026-12-31'));
    await refused('GET costs/window', 403, () => new CostsController().window('2026-01-01', '2026-12-31'));
    await refused('GET costs/overview', 403, () => new CostsController().overview());
    await refused('GET costs/entries', 403, () => new CostsController().entries());
    await refused('POST costs/purchases', 403, () =>
      new CostsController().purchase({ inventoryItemId: NO_SUCH_ID, quantity: 1, amountCents: 1, boughtOn: '2026-01-01' }),
    );
    await refused('POST costs/maintenance-service', 403, () =>
      new CostsController().service({ maintenanceRequestId: NO_SUCH_ID, amountCents: 1, performedOn: '2026-01-01' }),
    );
    await refused('GET inventory/export', 403, () => new InventoryController().exportAll(fac));
    await refused('GET inventory/lost-and-found', 403, () =>
      new InventoryController().lostAndFound(fac),
    );
    // POOLSE-154: every working role records and gives back; a family never.
    await refused('POST inventory/lost-and-found', 403, () =>
      new InventoryController().recordFound({ facilityId: fac, description: 'Toalha' }),
    );
    await refused('POST inventory/lost-and-found/:id/return', 403, () =>
      new InventoryController().giveBack(NO_SUCH_ID),
    );
    await refused('GET places', 403, () => new PlacesController().search('Lisboa'));
    // 13-10-2026 sweep: the one handler that had no role check.
    await refused('GET weather', 403, () => new WeatherController().current('38.7', '-9.1'));
    await refused('GET incidents/people', 403, () =>
      new IncidentsController().people('student', 'Alice'),
    );
  });
});

test('the overlapping-lessons list is owner/admin: an instructor is refused too — POOLSE-144', async () => {
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('GET class-groups/clashes as instructor', 403, () => new ClassesController().clashes());
  });
});

test('a pool or a recinto is created by the office only: maintenance and an instructor are refused, nothing written — POOLSE-152', async () => {
  const pools = await count('pool');
  const areas = await count('playing_area');
  const fac = tenantRef.facilityId;
  for (const [membershipId, roles] of [
    [fixture.maintenanceId, ['maintenance']],
    [fixture.instructorId, ['instructor']],
  ] as const) {
    await as(membershipId, [...roles], async () => {
      await refused(`POST facilities/:id/pools as ${roles[0]}`, 403, () =>
        new FacilitiesController().addPool(fac, { name: 'Tanque', kind: 'indoor' }),
      );
      await refused(`POST facilities/:id/playing-areas as ${roles[0]}`, 403, () =>
        new FacilitiesController().addPlayingArea(fac, { sportId: 'tennis', name: 'Campo' }),
      );
    });
  }
  assert.equal(await count('pool'), pools, 'no pool was written');
  assert.equal(await count('playing_area'), areas, 'no recinto was written');
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

    // POOLSE-86: a family's own choice about club messages — the people it is for.
    const preference = await new OwnEmailPreferenceController().read();
    assert.equal(typeof preference.optedOut, 'boolean', `${label}: own email preference`);

    // POOLSE-90 slice 4: their own phone's push switch — own device only.
    assert.equal(typeof new PushController().config().available, 'boolean', `${label}: push config`);
    assert.ok(Array.isArray((await new PushController().mine()).subscriptions), `${label}: own devices`);
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

test('the subscription and its avatar warning refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const subscription = new SubscriptionController();
    await refused('GET subscription', 403, () => subscription.read());
    await refused('GET subscription/alert', 403, () => subscription.alert());
  });
});

test('the results inbox refuses a guardian and a student (403) — POOLSE-114', async () => {
  await asEach(async () => {
    const inbox = new MeetInboxController();
    await refused('GET meet-inbox', 403, () => inbox.list());
    await refused('GET meet-inbox/count', 403, () => inbox.count());
    await refused('GET meet-inbox/:id/file', 403, () => inbox.file(NO_SUCH_ID));
    await refused('POST meet-inbox/:id/discard', 403, () => inbox.discard(NO_SUCH_ID, {}));
    await refused('POST meet-inbox/address', 403, () => inbox.regenerate());
  });
});

test('lesson feedback: staff routes refuse families (403), a stranger and staff cannot write it — POOLSE-116', async () => {
  await asEach(async () => {
    const feedback = new FeedbackController();
    await refused('GET students/:id/feedback', 403, () => feedback.forStudent(fixture.aliceId));
    await refused('POST feedback/:id/archive', 403, () => feedback.archive(NO_SUCH_ID));
  });
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    await refused('GET students/:id/feedback as maintenance', 403, () =>
      new FeedbackController().forStudent(fixture.aliceId),
    );
  });
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('POST feedback/:id/archive as an instructor', 403, () =>
      new FeedbackController().archive(NO_SUCH_ID),
    );
    await refused('PUT app/lessons/:id/feedback as staff', 403, () =>
      new AppController().feedback(fixture.sessionId, { studentId: fixture.aliceId, mood: 4 }),
    );
  });
  await as(fixture.unlinkedGuardianId, ['guardian'], async () => {
    await refused('PUT app/lessons/:id/feedback as a stranger', 404, () =>
      new AppController().feedback(fixture.sessionId, { studentId: fixture.aliceId, mood: 4 }),
    );
  });
});

test('Vou / Não vou and the instructor home: families only write their own, staff only read — POOLSE-90 slice 2', async () => {
  await asEach(async () => {
    await refused('GET app/teaching as a family', 403, () => new AppController().teaching());
    await refused('GET app/teaching/feedback as a family', 403, () => new AppController().teachingFeedback());
  });
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('PUT sessions/:id/notices/:studentId as staff', 403, () =>
      new NoticesController().answer(fixture.sessionId, fixture.aliceId, { going: false }),
    );
  });
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    await refused('GET app/teaching as maintenance', 403, () => new AppController().teaching());
    await refused('GET app/teaching/feedback as maintenance', 403, () => new AppController().teachingFeedback());
  });
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('GET app/maintenance as an instructor', 403, () => new AppController().maintenance());
  });
  await asEach(async () => {
    await refused('GET app/maintenance as a family', 403, () => new AppController().maintenance());
  });
  await as(fixture.unlinkedGuardianId, ['guardian'], async () => {
    await refused('PUT sessions/:id/notices/:studentId as a stranger', 404, () =>
      new NoticesController().answer(fixture.sessionId, fixture.aliceId, { going: false }),
    );
  });
});

test('a staff identity refuses families and a colleague — POOLSE-100', async () => {
  await asEach(async () => {
    await refused('GET staff/:id/identity as a family', 403, () => new StaffController().identity(fixture.instructorId));
    await refused('PATCH staff/:id/identity as a family', 403, () =>
      new StaffController().editIdentity(fixture.instructorId, { birthDate: '1990-01-01' }),
    );
  });
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    await refused('GET staff/:id/identity as a colleague', 403, () => new StaffController().identity(fixture.instructorId));
  });
});

test('staff details refuse families and a colleague — POOLSE-149', async () => {
  await asEach(async () => {
    await refused('GET staff/:id/details as a family', 403, () => new StaffController().details(fixture.instructorId));
    await refused('PATCH staff/:id/sports as a family', 403, () =>
      new StaffController().setSports(fixture.instructorId, { sports: ['pool'] }),
    );
    await refused('PATCH staff/:id/details as a family', 403, () =>
      new StaffController().editDetails(fixture.instructorId, { locality: 'Lisboa' }),
    );
    await refused('POST staff/:id/identity/photo/front as a family', 403, () =>
      new StaffController().fileIdPhoto(fixture.instructorId, 'front', 'x.jpg', Buffer.from([0xff, 0xd8, 0xff])),
    );
    await refused('DELETE staff/:id/identity/photo/front as a family', 403, () =>
      new StaffController().removeIdPhoto(fixture.instructorId, 'front'),
    );
    await refused('GET staff/:id/contract as a family', 403, () => new StaffController().contract(fixture.instructorId));
    await refused('PATCH staff/:id/contract as a family', 403, () =>
      new StaffController().editContract(fixture.instructorId, { kind: 'services' }),
    );
    await refused('POST staff/:id/contract/file as a family', 403, () =>
      new StaffController().fileContract(fixture.instructorId, 'x.pdf', Buffer.from('%PDF-1.4')),
    );
    await refused('DELETE staff/:id/contract/file as a family', 403, () =>
      new StaffController().removeContract(fixture.instructorId),
    );
  });
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    await refused('GET staff/:id/details as a colleague', 403, () => new StaffController().details(fixture.instructorId));
    await refused('PATCH staff/:id/details as a colleague', 403, () =>
      new StaffController().editDetails(fixture.instructorId, { locality: 'Lisboa' }),
    );
    await refused('POST staff/:id/identity/photo/front as a colleague', 403, () =>
      new StaffController().fileIdPhoto(fixture.instructorId, 'front', 'x.jpg', Buffer.from([0xff, 0xd8, 0xff])),
    );
    await refused('DELETE staff/:id/identity/photo/front as a colleague', 403, () =>
      new StaffController().removeIdPhoto(fixture.instructorId, 'front'),
    );
    await refused('GET staff/:id/contract as a colleague', 403, () => new StaffController().contract(fixture.instructorId));
    await refused('POST staff/:id/contract/file as a colleague', 403, () =>
      new StaffController().fileContract(fixture.instructorId, 'x.pdf', Buffer.from('%PDF-1.4')),
    );
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
    await refused('POST qualifying/age-groups/fpn', 403, () => q.addFpnAgeGroups({}));
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

// POOLSE-129 — a family is invited from the student's record.
test('family invitations refuse a guardian and a student (403), and maintenance', async () => {
  const probe = async (): Promise<void> => {
    const routes = new StudentInvitationsController();
    await refused('GET students/:id/invitations', 403, () => routes.list(fixture.aliceId));
    await refused('POST students/:id/invitations', 403, () =>
      routes.create(fixture.aliceId, { membershipId: fixture.martaId, channel: 'link' }),
    );
    await refused('POST students/:id/invitations/:id/reissue', 403, () => routes.reissue(fixture.aliceId, NO_SUCH_ID));
    await refused('POST students/:id/invitations/:id/revoke', 403, () => routes.revoke(fixture.aliceId, NO_SUCH_ID));
    await refused('POST family-invitations/bulk', 403, () => new FamilyInvitationsBulkController().bulk({}));
    await refused('POST family-invitations/new-student', 403, () =>
      new FamilyInvitationsBulkController().newStudent({ firstName: 'X', lastName: 'Y', phone: '912000000' }),
    );
  };
  await asEach(probe);
  await as(fixture.maintenanceId, ['maintenance'], probe);
});

// POOLSE-132 — a student's documents and the club's FPN settings.
test('student documents and FPN settings refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const docs = new StudentDocumentsController();
    await refused('GET students/:id/documents', 403, () => docs.read(fixture.aliceId));
    await refused('PATCH students/:id/documents', 403, () => docs.save(fixture.aliceId, { disciplines: ['pura'] }));
    await refused('POST students/:id/documents/copies', 403, () =>
      docs.file(fixture.aliceId, { kind: 'socio_form', fileId: NO_SUCH_ID }),
    );
    // POOLSE-179: a filled form answers the child's own family, so a stranger gets a family's 404.
    await refused('GET students/:id/documents/fpn', 404, () => docs.print(fixture.aliceId, undefined, undefined));
    await refused('GET students/:id/documents/id-document', 403, () => docs.idDocument(fixture.aliceId));
    await refused('PATCH fpn-settings', 403, () => new FpnSettingsController().save({ association: 'X' }));
    await refused('GET students/:id/boletim', 404, () => new BoletimController().print(fixture.aliceId));
    // POOLSE-142 — the club's own boletim template.
    const template = new DocumentTemplatesController();
    await refused('GET settings/document-templates/:kind', 403, () => template.read('socio_form'));
    await refused('PUT settings/document-templates/:kind', 403, () => template.set('fpn_declaration', { fileId: NO_SUCH_ID }));
    await refused('PUT settings/document-templates/:kind/fields', 403, () => template.place('socio_form', { fields: [] }));
    await refused('DELETE settings/document-templates/:kind', 403, () => template.remove('fpn_declaration_minor'));
  });
});

// POOLSE-133 — the exame médico.
test('medical exams refuse a guardian and a student (403)', async () => {
  await asEach(async () => {
    const exams = new MedicalExamsController();
    await refused('GET students/:id/medical-exams', 403, () => exams.list(fixture.aliceId));
    await refused('POST students/:id/medical-exams', 403, () =>
      exams.record(fixture.aliceId, { examinedOn: '2026-01-01', result: 'fit' }),
    );
    await refused('POST students/:id/medical-exams/:id/archive', 403, () => exams.archive(fixture.aliceId, NO_SUCH_ID));
  });
});

test("a student's level per sport refuses a guardian, a student and an instructor (403) — POOLSE-148", async () => {
  await asEach(async () => {
    await refused('PUT students/:id/sport-level', 403, () =>
      new StudentSportLevelController().set(fixture.aliceId, { sport: 'pool', levelId: null }),
    );
  });
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('PUT students/:id/sport-level as instructor', 403, () =>
      new StudentSportLevelController().set(fixture.aliceId, { sport: 'pool', levelId: null }),
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
    await refused('PUT students/:id/photo', 403, () => new AttachmentsController().setStudentPhoto(NO_SUCH_ID, { fileId: null }));
    await refused('PUT staff/:id/photo', 403, () => new AttachmentsController().setStaffPhoto(NO_SUCH_ID, { fileId: null }));
  });
});

test('the qualifications list and its certificate filter refuse a guardian and a student (403) — POOLSE-97', async () => {
  await asEach(async () => {
    const qualifications = new QualificationsController();
    await refused('GET qualifications/expiring', 403, () => qualifications.expiring());
    await refused('GET qualifications/expiring?certificate=missing', 403, () =>
      qualifications.expiring(undefined, undefined, 'missing'),
    );
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

test('a view of a person refuses a guardian and a student (403)', async () => {
  await asEach(async () => {
    const view = new AppViewController();
    await refused('GET app-view/people', 403, () => view.people('family'));
    await refused('POST app-view', 403, () => view.start({ hat: 'family', membershipId: NO_SUCH_ID }));
    await refused('POST app-view/leave', 403, () => view.leave());
    await refused('POST sessions/:id/cover-request', 403, () => new CoverRequestsController().request(NO_SUCH_ID, {}));
    await refused('POST sessions/:id/cover-request/withdraw', 403, () => new CoverRequestsController().withdraw(NO_SUCH_ID));
    await refused('GET lesson-requests', 403, () => new LessonRequestsController().open());
    await refused('POST lesson-requests/:id/seen', 403, () => new LessonRequestsController().seen(NO_SUCH_ID));
    const staff = new StaffController();
    await refused('PUT staff/:id/login-photo', 403, () => staff.setLoginPhoto(NO_SUCH_ID, Buffer.from('x')));
    await refused('DELETE staff/:id/login-photo', 403, () => staff.removeLoginPhoto(NO_SUCH_ID));
    await refused('GET app-view/history', 403, () => view.history());
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

test('the energy dashboard and the read log refuse a guardian and a student (403) — POOLSE-106', async () => {
  await asEach(async () => {
    const energy = new EnergyInvoicesController();
    await refused('GET energy/summary', 403, () => energy.summary());
  });
});

test('the AI readers meter refuses a guardian and a student (403) — POOLSE-137', async () => {
  await asEach(async () => {
    const meter = new AiReadsController();
    for (const reader of AI_READERS) {
      await refused(`POST ai-reads/claim (${reader})`, 403, () => meter.claim({ reader }));
    }
    await refused('POST ai-reads/:id/finish', 403, () => meter.finish(NO_SUCH_ID, { succeeded: true }));
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
    await refused('POST facilities/pools/:poolId/lab-results/import', 403, () =>
      lab.importReport(NO_SUCH_ID, { rows: [{ e_coli: '0' }], commit: false }),
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

test('where the club is paid refuses a guardian and a student (403) — POOLSE-94', async () => {
  await asEach(async () => {
    await refused('PUT settings/payment-details', 403, () =>
      new SettingsController().savePaymentDetails({ iban: 'PT50000201231234567890154' }),
    );
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
    // The seguro line is staff's; a family reads its fees tab instead (POOLSE-88).
    assert.equal(alice.cover, null);
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
    // An instructor sees whether she is insured, and nothing of what anybody pays.
    assert.equal(alice.cover?.covered, false);
    assert.equal(Object.keys(alice.cover ?? {}).some((key) => /cents|amount/i.test(key)), false);
  });
});

test("app mode: a family reads its own agenda and lessons, and nobody else's (POOLSE-90)", async () => {
  await as(fixture.martaId, ['guardian'], async () => {
    const agenda = await new AppController().agenda();
    assert.deepEqual(agenda.children.map((child) => child.id), [fixture.aliceId]);
    assert.ok(
      agenda.entries.some((entry) => entry.sessionId === fixture.sessionId && entry.studentId === fixture.aliceId),
      "Alice's lesson next week is on her mother's agenda",
    );
    const lesson = await new AppController().lesson(fixture.sessionId);
    assert.equal(lesson.entries[0]?.studentId, fixture.aliceId);

    await refused('GET app/agenda?child=:bruno as Marta', 404, () =>
      new AppController().agenda(fixture.brunoStudentId),
    );
  });

  // Linked to nobody: an empty agenda, and no lesson.
  await as(fixture.unlinkedGuardianId, ['guardian'], async () => {
    const agenda = await new AppController().agenda();
    assert.deepEqual(agenda.children, []);
    assert.deepEqual(agenda.entries, []);
    // POOLSE-109: no child, no leave to send an atestado for.
    assert.deepEqual((await new AppController().medicalLeave()).leaves, []);
    await refused('GET app/lessons/:id as a stranger', 404, () => new AppController().lesson(fixture.sessionId));
    await refused('GET app/lessons/not-a-uuid', 404, () => new AppController().lesson('not-a-uuid'));
    await refused('GET app/fees for a stranger', 404, () => new AppController().fees(fixture.aliceId));
    // POOLSE-201: pays for nobody, so no documents and none to open.
    assert.equal((await new AppController().invoices()).payer, false);
    await refused('GET app/invoices/:id as a stranger', 404, () => new AppController().invoice(NO_SUCH_ID));
    // POOLSE-121: nobody to ask for but a new child, and never somebody else's.
    assert.deepEqual((await new AppController().enrolmentOptions()).people, []);
    await refused('POST app/enrolment-requests for a stranger', 404, () =>
      new AppController().requestEnrolment({
        studentId: fixture.aliceId,
        classGroupId: NO_SUCH_ID,
        consent: true,
      }),
    );
  });
  await as(fixture.instructorId, ['instructor'], async () => {
    await refused('GET app/enrolment-requests as staff', 403, () => new AppController().enrolmentOptions());
    await refused('POST app/enrolment-requests as staff', 403, () =>
      new AppController().requestEnrolment({ studentId: fixture.aliceId, classGroupId: NO_SUCH_ID, consent: true }),
    );
  });

  // A student reads themselves.
  await as(fixture.studentMemberId, ['student'], async () => {
    const agenda = await new AppController().agenda();
    assert.deepEqual(agenda.children.map((child) => [child.id, child.self]), [[fixture.brunoStudentId, true]]);
  });

  // Staff are not a family: the backoffice is theirs.
  for (const [id, roles] of [
    [fixture.instructorId, ['instructor']],
    [fixture.adminId, ['admin']],
  ] as const) {
    await as(id, [...roles], async () => {
      await refused('GET app/agenda as staff', 403, () => new AppController().agenda());
      await refused('GET app/lessons/:id as staff', 403, () => new AppController().lesson(fixture.sessionId));
      await refused('GET app/medical-leave as staff', 403, () => new AppController().medicalLeave());
      await refused('GET app/invoices as staff', 403, () => new AppController().invoices());
      await refused('GET app/invoices/:id as staff', 403, () => new AppController().invoice(NO_SUCH_ID));
    });
  }
});

test('a student finds their own record through /family', async () => {
  await as(fixture.studentMemberId, ['student'], async () => {
    const { students } = await new FamilyController().mine();
    assert.deepEqual(students, [
      { id: fixture.brunoStudentId, name: students[0]!.name, relationship: null, self: true, photoFileId: null },
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

test('the atestado and the emergency-contact search — POOLSE-109: a family reaches only its own child, a coach never the file', async () => {
  // A leave on Alice with an atestado, written as the owner straight into the
  // tables: the refusals below all happen before the bucket is asked.
  const org = tenantRef.organizationId;
  const [leave] = await tenantRef.sql<{ id: string }>(
    `INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on)
     VALUES ($1, $2, DATE '2026-10-01', DATE '2026-10-20') RETURNING id`,
    [org, fixture.aliceId],
  );
  const [file] = await tenantRef.sql<{ id: string }>(
    `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name,
                              uploaded_by, wrapped_key)
     VALUES ($1, 'medical_certificate', $3, 'application/pdf', 10,
             'atestado.pdf', $2, 'v1.aa.bb.cc') RETURNING id`,
    [org, fixture.adminId, `${org}/medical_certificate/probe.sealed`],
  );
  await tenantRef.sql(
    `INSERT INTO medical_leave_certificate (organization_id, leave_id, file_id, attached_by) VALUES ($1, $2, $3, $4)`,
    [org, leave!.id, file!.id, fixture.adminId],
  );

  await asEach(async () => {
    const sensitive = new SensitiveController();
    await refused('GET students/:id/emergency-contact/candidates', 403, () => sensitive.candidates(fixture.aliceId, 'ana'));
    // Not their child: the family routes' 404, never a hint the student exists.
    await refused('POST students/:id/medical-leave/:id/certificate', 404, () =>
      sensitive.attachCertificate(fixture.aliceId, leave!.id, 'x.pdf', Buffer.from('%PDF-1.4')),
    );
    await refused('DELETE students/:id/medical-leave/:id/certificate', 403, () =>
      sensitive.detachCertificate(fixture.aliceId, leave!.id),
    );
    await refused('GET files/:id (atestado)', 403, () => new FilesController().read(file!.id));
  });

  // The coach: told the atestado exists, refused the file and every write.
  await as(fixture.instructorId, ['instructor'], async () => {
    const sensitive = new SensitiveController();
    const seen = (await sensitive.read(fixture.aliceId)).medicalLeave.find((one) => one.id === leave!.id);
    assert.ok(seen?.certificate !== null && seen?.certificate !== undefined, 'atestado anexado');
    assert.equal(seen.certificate.file, null);
    await refused('GET files/:id (atestado) as a coach', 403, () => new FilesController().read(file!.id));
    await refused('POST …/certificate as a coach', 403, () =>
      sensitive.attachCertificate(fixture.aliceId, leave!.id, 'x.pdf', Buffer.from('%PDF-1.4')),
    );
    await refused('DELETE …/certificate as a coach', 403, () => sensitive.detachCertificate(fixture.aliceId, leave!.id));
    await refused('GET …/emergency-contact/candidates as a coach', 403, () => sensitive.candidates(fixture.aliceId, 'ana'));
  });

  // Maintenance reaches none of it.
  await as(fixture.maintenanceId, ['maintenance'], async () => {
    await refused('GET files/:id (atestado) as maintenance', 403, () => new FilesController().read(file!.id));
    await refused('POST …/certificate as maintenance', 403, () =>
      new SensitiveController().attachCertificate(fixture.aliceId, leave!.id, 'x.pdf', Buffer.from('%PDF-1.4')),
    );
  });
});

// POOLSE-120: the layout asks everybody for the circles. A family or a student
// is answered with nothing to do — an empty map, never a 403 and never data.
test('GET attention answers a guardian and a student with an empty map', async () => {
  await asEach(async (who) => {
    assert.deepEqual(
      await new AttentionController().read(),
      { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {}, students: {} },
      who.label,
    );
  });
});

test('GET shell gives a guardian and a student the logo and nothing that is not theirs — POOLSE-172', async () => {
  await asEach(async (who) => {
    assert.deepEqual(
      await new ShellController().read(),
      {
        logoFileId: null,
        attention: { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {}, students: {} },
        meetInboxPending: null,
        subscriptionAlert: null,
        supportStatus: null,
      },
      who.label,
    );
  });
});

// --------------------------------------------------------------------------
// POOLSE-145 — a sport-only instructor, against every sport-scoped route
// --------------------------------------------------------------------------

test('a tennis-only instructor is refused every swimming route (403) — POOLSE-145', async () => {
  const org = tenantRef.organizationId;
  // Switching a sport on is the platform's; the test does it on the owner login.
  const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await owner.connect();
  await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [org]);
  await owner.query("UPDATE membership SET sports = '{tennis}' WHERE id = $1", [fixture.instructorId]);
  try {
    await as(fixture.instructorId, ['instructor'], async () => {
      const students = new StudentsController();
      await refused('GET students?sport=pool', 403, () =>
        students.list(undefined, undefined, undefined, undefined, undefined, undefined, 'pool'),
      );
      await refused('GET students?sport=none', 403, () =>
        students.list(undefined, undefined, undefined, undefined, undefined, undefined, 'none'),
      );
      await refused('GET students/:alice', 403, () => students.one(fixture.aliceId));
      await refused('GET transfer-proposals?sport=pool', 403, () =>
        new AdvancementController().list(undefined, undefined, 'pool'),
      );
      await refused('GET qualifying', 403, () => new QualifyingController().read());
      await refused('GET meets', 403, () => new MeetsController().list());
      await refused('GET students/:alice/progression', 403, () => new RecordsController().read(fixture.aliceId));
      // No sport asked for is an absence, never a row of swimming.
      const mine = await students.list();
      assert.ok(mine.students.items.every((one) => (one.sports ?? []).includes('tennis')));
    });
  } finally {
    await owner.query("UPDATE membership SET sports = '{pool}' WHERE id = $1", [fixture.instructorId]);
    await owner.query("UPDATE organization SET enabled_sports = '{pool}' WHERE id = $1", [org]);
    await owner.end();
  }
});

// --------------------------------------------------------------------------
// POOLSE-157 — the staff screens by role, one rule per test
// --------------------------------------------------------------------------

/** The working roles that are not the office. */
function workers(): { label: string; membershipId: string; roles: MemberRole[] }[] {
  return [
    { label: 'instructor', membershipId: fixture.instructorId, roles: ['instructor'] },
    { label: 'maintenance', membershipId: fixture.maintenanceId, roles: ['maintenance'] },
  ];
}

test("POOLSE-157 rule 1: Funções and Acesso are the office's — a worker cannot change a staff member's roles or re-invite them", async () => {
  for (const who of workers()) {
    await as(who.membershipId, who.roles, async () => {
      const people = new PeopleDedupController();
      await refused(`POST people/:id/roles as ${who.label}`, 403, () =>
        people.grant(fixture.awayInstructorId, { role: 'maintenance' }),
      );
      await refused(`POST people/:id/roles/:role/revoke as ${who.label}`, 403, () =>
        people.revoke(fixture.awayInstructorId, 'instructor'),
      );
      await refused(`POST staff/:id/reinvite as ${who.label}`, 403, () =>
        new StaffController().move(fixture.awayInstructorId, { email: 'x@example.com' }),
      );
      await refused(`POST staff/:id/reinvite/cancel as ${who.label}`, 403, () =>
        new StaffController().cancel(fixture.awayInstructorId),
      );
      await refused(`POST staff/:id/archive as ${who.label}`, 403, () =>
        new StaffController().archive(fixture.awayInstructorId),
      );
    });
  }
});

test('POOLSE-157 rule 2: every worker files leave and reads Em aprovação as dates and names; only the office decides', async () => {
  // Maintenance files a request of its own — a Wednesday, far from the fixture's days.
  const { id } = await as(fixture.maintenanceId, ['maintenance'], () =>
    new VacationsController().request({ days: ['2027-03-10'], kind: 'medical', reason: 'Consulta de rotina' }),
  );
  assert.ok(id, 'maintenance filed its own request');

  try {
    for (const who of workers()) {
      await as(who.membershipId, who.roles, async () => {
        const queue = await new VacationsController().pending();
        const mine = queue.requests.items.find((request) => request.id === id);
        assert.ok(mine, `${who.label} reads the queue`);
        assert.deepEqual(mine.days, ['2027-03-10']);
        assert.equal(mine.membershipId, fixture.maintenanceId, `${who.label} sees whose request it is`);
        // Dates and names only: the kind and the words stay with the office.
        assert.equal(mine.reason ?? null, null, `${who.label} reads no reason`);
        assert.equal(mine.kind ?? null, null, `${who.label} reads no kind`);
        assert.equal(JSON.stringify(queue).includes('Consulta de rotina'), false, 'the reason is nowhere in the payload');

        await refused(`POST vacations/requests/:id/approve as ${who.label}`, 403, () =>
          new VacationsController().approve(id, {}),
        );
        await refused(`POST vacations/requests/:id/reject as ${who.label}`, 403, () =>
          new VacationsController().reject(id, { note: 'Não' }),
        );
      });
    }

    // The office still reads the whole request.
    await as(fixture.adminId, ['admin'], async () => {
      const queue = await new VacationsController().pending();
      const mine = queue.requests.items.find((request) => request.id === id);
      assert.equal(mine?.reason, 'Consulta de rotina', 'the office reads the reason');
      assert.equal(mine?.kind, 'medical');
      // Another club's request, or none: 404, never a decision.
      await refused('POST vacations/requests/:other/approve as admin', 404, () =>
        new VacationsController().approve(NO_SUCH_ID, {}),
      );
    });
  } finally {
    // Withdrawn again so later tests see the fixture as it was.
    await as(fixture.maintenanceId, ['maintenance'], () => new VacationsController().withdraw(id));
  }
});

test('POOLSE-157 rule 3: every worker reads the team map, names and approved days only', async () => {
  for (const who of workers()) {
    await as(who.membershipId, who.roles, async () => {
      const team = await new VacationsController().team('2026');
      assert.ok(Array.isArray(team.members), `${who.label} reads the team map`);
      assert.equal(JSON.stringify(team).includes('Cirurgia'), false, 'no reason on the map');
      for (const member of team.members) {
        assert.deepEqual(Object.keys(member).sort(), ['days', 'membershipId', 'name']);
      }
    });
  }
});

test("POOLSE-157 rule 4: Salários are the office's — a worker is refused every read, their own included", async () => {
  for (const who of workers()) {
    await as(who.membershipId, who.roles, async () => {
      await refused(`GET staff/salaries as ${who.label}`, 403, () => new SalariesController().list());
      await refused(`GET staff/salaries/summary as ${who.label}`, 403, () => new SalariesController().summary());
      await refused(`GET staff/:id/compensation (own) as ${who.label}`, 403, () =>
        new CompensationController().history(who.membershipId),
      );
    });
  }
});

test("POOLSE-157 rule 5: Qualificações — a worker reads their own and nobody else's, and not the club list", async () => {
  for (const who of workers()) {
    await as(who.membershipId, who.roles, async () => {
      const own = await new QualificationsController().person(who.membershipId);
      assert.equal(own.canManage, false, `${who.label} reads their own, read-only`);
      await refused(`GET staff/:other/qualifications as ${who.label}`, 403, () =>
        new QualificationsController().person(fixture.adminId),
      );
      await refused(`GET qualifications/expiring as ${who.label}`, 403, () =>
        new QualificationsController().expiring(),
      );
    });
  }
  await as(fixture.adminId, ['admin'], async () => {
    await refused('GET staff/:unknown/qualifications as admin', 404, () =>
      new QualificationsController().person(NO_SUCH_ID),
    );
  });
});

test('POOLSE-157 rule 7: a guardian and a student are refused every staff screen above, their own id included', async () => {
  await asEach(async ({ label }) => {
    const self = label === 'student' ? fixture.studentMemberId : fixture.unlinkedGuardianId;
    const vacations = new VacationsController();
    await refused(`GET vacations/pending as ${label}`, 403, () => vacations.pending());
    await refused(`GET vacations/team as ${label}`, 403, () => vacations.team('2026'));
    await refused(`POST vacations/requests/:id/approve as ${label}`, 403, () => vacations.approve(NO_SUCH_ID, {}));
    await refused(`POST vacations/requests/:id/reject as ${label}`, 403, () =>
      vacations.reject(NO_SUCH_ID, { note: 'Não' }),
    );
    await refused(`GET staff/salaries as ${label}`, 403, () => new SalariesController().list());
    await refused(`GET staff/:id/compensation as ${label}`, 403, () => new CompensationController().history(self));
    await refused(`GET staff/:id/qualifications (a colleague) as ${label}`, 403, () =>
      new QualificationsController().person(fixture.instructorId),
    );
    await refused(`GET staff/:id/qualifications (own) as ${label}`, 403, () =>
      new QualificationsController().person(self),
    );
    await refused(`POST people/:staff/roles as ${label}`, 403, () =>
      new PeopleDedupController().grant(fixture.instructorId, { role: 'maintenance' }),
    );
    await refused(`POST staff/:id/reinvite as ${label}`, 403, () =>
      new StaffController().move(fixture.instructorId, { email: 'x@example.com' }),
    );
  });
});

test('POOLSE-193, -194: the family’s FPN and classmates routes answer a stranger with nothing', async () => {
  await asEach(async ({ label }) => {
    const app = new AppController();
    await refused(`GET app/documents/fpn as ${label}`, 404, () => app.fpnReview(NO_SUCH_ID));
    await refused(`PATCH app/documents/fpn as ${label}`, 404, () => app.saveFpnDetails(NO_SUCH_ID, {}));
    await refused(`GET app/lessons/:id/classmates as ${label}`, 404, () => app.classmates(NO_SUCH_ID));
  });
});

test('POOLSE-195: a family reads a Desafio and never writes one', async () => {
  await asEach(async ({ label }) => {
    await refused(`PUT sessions/:id/challenge as ${label}`, 403, () =>
      new SessionsCalendarController().saveChallenge(NO_SUCH_ID, { body: 'a' }),
    );
  });
});

test('POOLSE-192: a scheduled exam — a guardian and a student reach none of it', async () => {
  await asEach(async ({ label }) => {
    const schedule = new MedicalExamScheduleController();
    await refused(`GET medical-exam-schedule as ${label}`, 403, () => schedule.read(NO_SUCH_ID));
    await refused(`POST medical-exam-schedule as ${label}`, 403, () =>
      schedule.create(NO_SUCH_ID, { kind: 'deadline', dueOn: '2099-01-01' }),
    );
    await refused(`POST remind as ${label}`, 403, () =>
      schedule.remind(NO_SUCH_ID, NO_SUCH_ID, { channel: 'email', subject: 'a', body: 'b' }),
    );
    await refused(`POST cancel as ${label}`, 403, () => schedule.cancel(NO_SUCH_ID, NO_SUCH_ID));
  });
});

test('POOLSE-191: a message to one student — a guardian and a student cannot read or send one', async () => {
  await asEach(async ({ label }) => {
    await refused(`GET students/:id/messages as ${label}`, 403, () => new StudentMessagesController().list(NO_SUCH_ID));
    await refused(`POST students/:id/messages as ${label}`, 403, () =>
      new StudentMessagesController().send(NO_SUCH_ID, { channel: 'email', subject: 'a', body: 'b' }),
    );
  });
});

test('POOLSE-166: avisos — a guardian and a student cannot list, post or end one; the app read answers them, empty when unlinked', async () => {
  await asEach(async ({ label }) => {
    await refused(`GET avisos as ${label}`, 403, () => new AvisosController().list());
    await refused(`POST avisos as ${label}`, 403, () =>
      new AvisosController().post({
        audience: 'class_group',
        targetId: fixture.groupId,
        subject: 'x',
        body: 'x',
        shownFrom: '2026-11-04',
        shownUntil: '2026-11-05',
      }),
    );
    await refused(`DELETE avisos/:id as ${label}`, 403, () => new AvisosController().archive(NO_SUCH_ID));
    const { avisos } = await new AppAvisosController().mine();
    assert.ok(Array.isArray(avisos), `GET app/avisos answers ${label}`);
  });
});

test('POOLSE-169: the staff board — a guardian and a student cannot read, pin or take down a note', async () => {
  await asEach(async ({ label }) => {
    await refused(`GET staff-notes as ${label}`, 403, () => new StaffNotesController().list());
    await refused(`POST staff-notes as ${label}`, 403, () => new StaffNotesController().pin({ body: 'x' }));
    await refused(`DELETE staff-notes/:id as ${label}`, 403, () => new StaffNotesController().remove(NO_SUCH_ID));
  });
});

test('person categories are the office’s; a family reads only its own — POOLSE-202', async () => {
  const office = ['instructor', 'maintenance'] as const;
  for (const [id, role] of [[fixture.instructorId, office[0]], [fixture.maintenanceId, office[1]]] as const) {
    await as(id, [role], async () => {
      const api = new PersonCategoriesController();
      await refused(`GET person-categories as ${role}`, 403, () => api.list(fixture.aliceId));
      await refused(`GET person-categories/expiring as ${role}`, 403, () => api.expiring());
      await refused(`POST person-categories as ${role}`, 403, () =>
        api.add({ studentId: fixture.aliceId, categoryId: NO_SUCH_ID, proofSeenOn: '2026-11-01' }),
      );
      await refused(`PATCH person-categories/:id as ${role}`, 403, () => api.renew(NO_SUCH_ID, {}));
      await refused(`POST person-categories/:id/archive as ${role}`, 403, () => api.remove(NO_SUCH_ID));
      await refused(`POST fee-categories/rank as ${role}`, 403, () => new FeeCategoriesController().rank({ ids: [] }));
      await refused(`GET app/categories as ${role}`, 403, () => new AppController().categories());
      // POOLSE-203: the price table and the per-person price are the office's.
      await refused(`PUT pass-products/:id/prices as ${role}`, 403, () =>
        new PassProductsController().setPrice(NO_SUCH_ID, NO_SUCH_ID, { categoryIds: [], amountCents: 0 }),
      );
      await refused(`POST pass-products/:id/prices/:priceId/archive as ${role}`, 403, () =>
        new PassProductsController().archivePrice(NO_SUCH_ID, NO_SUCH_ID, NO_SUCH_ID),
      );
      await refused(`GET reception/people/:id/prices as ${role}`, 403, () =>
        new ReceptionController().prices(NO_SUCH_ID, fixture.martaId),
      );
    });
  }
  await asEach(async () => {
    await refused('GET person-categories as a family', 403, () => new PersonCategoriesController().list(fixture.aliceId));
  });
});
