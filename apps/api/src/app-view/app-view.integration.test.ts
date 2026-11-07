import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod, type Type } from '@nestjs/common';
import pg from 'pg';
import { ActivityController } from '../activity/activity.controller.js';
import { AppController } from '../app/app.controller.js';
import { AppModule } from '../app.module.js';
import { authStorage } from '../auth/auth.context.js';
import { MeController } from '../identity/me.controller.js';
import { AppAvisosController } from '../messages/avisos.controller.js';
import { StudentMessagesController } from '../messages/student-messages.controller.js';
import { FamilyController } from '../students/students.controller.js';
import { supportActivity } from '../support/support.repository.js';
import {
  fileOpensInView,
  instructorPhotoSql,
  isViewLeave,
  viewReadRoute,
} from '../tenant/app-view.js';
import { currentTenant, tenantStorage } from '../tenant/tenant.context.js';
import { TenantMiddleware } from '../tenant/tenant.middleware.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { AppViewController } from './app-view.controller.js';
import { listSupportViews } from './app-view.repository.js';

/**
 * Seeing the app as a real person — POOLSE-188, against the real database and the
 * real `TenantMiddleware`: a view is decided there, so a test that sets the
 * context by hand would prove nothing. Only Express is missing.
 *
 * Run: pnpm api:test
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const middleware = new TenantMiddleware();
const operators: string[] = [];

after(async () => {
  for (const id of operators) {
    await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [id]);
  }
  await owner.end();
  await closeHarness();
});

const ID = '11111111-1111-4111-8111-111111111111';

async function clerkOf(membershipId: string): Promise<string> {
  const { rows } = await owner.query<{ clerk_user_id: string }>(
    `SELECT u.clerk_user_id FROM app_user u JOIN membership m ON m.app_user_id = u.id WHERE m.id = $1`,
    [membershipId],
  );
  return rows[0]!.clerk_user_id;
}

/** Gives a typed-in member a login: only somebody with one can be viewed. */
async function withLogin(membershipId: string): Promise<string> {
  const clerkUserId = `user_view_${membershipId}`;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app_user (clerk_user_id, cached_email) VALUES ($1, $2) RETURNING id`,
    [clerkUserId, `${membershipId}@example.test`],
  );
  // A login owns the name and the address, so the typed ones leave.
  await owner.query(
    `UPDATE membership SET app_user_id = $1, first_name = NULL, last_name = NULL, email = NULL WHERE id = $2`,
    [rows[0]!.id, membershipId],
  );
  return clerkUserId;
}

/** One request through the real middleware, with nothing that says a view is on. */
function request<T>(clerkUserId: string, method: string, url: string, fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: 'sess' } as never, () =>
    new Promise<T>((resolve, reject) => {
      const req = { method, originalUrl: url, path: url, header: () => undefined } as never;
      middleware
        .use(req, {} as never, (error?: unknown) => {
          if (error !== undefined) {
            reject(error as Error);
            return;
          }
          fn().then(resolve, reject);
        })
        .catch(reject);
    }),
  );
}

async function code(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
    return 'passed';
  } catch (error) {
    return (error as { response?: { code?: unknown } }).response?.code;
  }
}

async function seedFamily(tenant: ScratchTenant): Promise<{ guardian: string; child: string; clerk: string }> {
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const clerk = await withLogin(guardian);
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Alice', 'Silva', club_today() - interval '10 years') RETURNING id`,
    [tenant.organizationId],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [tenant.organizationId, row!.id, guardian],
  );
  return { guardian, child: row!.id, clerk };
}

function start(tenant: ScratchTenant, hat: string, membershipId: string, options: { reason?: string; support?: boolean; as?: string; roles?: ('owner' | 'admin')[] } = {}): Promise<{ id: string }> {
  return actingAs(
    tenant,
    {
      ...(options.as === undefined ? {} : { membershipId: options.as }),
      roles: options.roles ?? ['owner'],
      ...(options.support === true ? { support: true } : {}),
    },
    () => new AppViewController().start({ hat, membershipId, ...(options.reason === undefined ? {} : { reason: options.reason }) }),
  );
}

async function supportSession(tenant: ScratchTenant): Promise<{ membership: string; clerk: string }> {
  const clerk = `user_view_op_${tenant.organizationId}`;
  operators.push(clerk);
  await owner.query(`INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'teste')`, [clerk]);
  const { rows: user } = await owner.query<{ id: string }>(
    `INSERT INTO app_user (clerk_user_id) VALUES ($1) RETURNING id`,
    [clerk],
  );
  const { rows: grant } = await owner.query<{ id: string }>(
    `INSERT INTO support_grant (organization_id, source, granted_by_membership_id, starts_at, expires_at)
     VALUES ($1, 'owner', $2, now() - interval '1 minute', now() + interval '2 hours') RETURNING id`,
    [tenant.organizationId, tenant.ownerMembershipId],
  );
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO membership (organization_id, app_user_id, status, support_grant_id)
     VALUES ($1, $2, 'active', $3) RETURNING id`,
    [tenant.organizationId, user[0]!.id, grant[0]!.id],
  );
  return { membership: rows[0]!.id, clerk };
}

test('the reader answers as the person, and the log names the reader (QA 1, 7, 10)', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardian, child } = await seedFamily(tenant);
    const reader = await clerkOf(tenant.ownerMembershipId);
    await start(tenant, 'family', guardian);

    const seen = await request(reader, 'GET', '/app/fees?child=x', async () => {
      const context = currentTenant();
      assert.equal(context.membershipId, guardian);
      assert.deepEqual(context.roles, ['guardian']);
      assert.equal(context.actor?.membershipId, tenant.ownerMembershipId);
      return new AppController().documents(child);
    });
    assert.equal(seen.children[0]!.id, child);
    for (const row of seen.children[0]!.documents) {
      assert.equal(row.print, null, 'a view takes no form');
      assert.equal(row.canSend, false, 'a view sends no paper');
      assert.notEqual(row.kind, 'medical_exam', 'an exam state can say unfit (rule 8)');
    }

    const reads = await tenant.sql<{ actor: string; data: { route: string }; entity_id: string }>(
      `SELECT actor_membership_id AS actor, data, entity_id FROM audit_log WHERE action = 'app_view.read'`,
    );
    assert.equal(reads.length, 1);
    assert.equal(reads[0]!.actor, tenant.ownerMembershipId);
    assert.equal(reads[0]!.entity_id, guardian);
    assert.equal(reads[0]!.data.route, '/app/fees', 'a pattern, never the URL');
  });
});

test('every write is refused, and only Sair gets through (QA 2, 11)', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardian, child } = await seedFamily(tenant);
    const reader = await clerkOf(tenant.ownerMembershipId);
    await start(tenant, 'family', guardian);
    const never = async (): Promise<void> => assert.fail('the handler ran');

    for (const [method, url] of [
      ['POST', '/students'],
      ['PUT', `/app/lessons/${ID}/feedback`],
      ['PATCH', `/app/documents/fpn`],
      ['POST', `/app/progress/${child}/times`],
      ['POST', '/push/subscribe'],
      ['POST', '/app-view'],
      ['DELETE', `/files/${ID}`],
    ] as const) {
      assert.equal(await code(request(reader, method, url, never)), 'viewing_as', `${method} ${url}`);
    }

    const me = new MeController();
    await authStorage.run({ clerkUserId: reader, sessionId: 's' } as never, async () => {
      assert.equal(await code(me.updateProfile({} as never)), 'viewing_as');
      assert.equal(await code(me.setPhoto(Buffer.from('x'))), 'viewing_as');
      assert.equal(await code(me.removePhoto()), 'viewing_as');
    });

    await request(reader, 'POST', '/app-view/leave', () => new AppViewController().leave());
    const [row] = await tenant.sql<{ ended: Date | null }>(`SELECT ended_at AS ended FROM app_view`);
    assert.notEqual(row!.ended, null);

    // Themselves again, with their writes.
    assert.equal(await code(request(reader, 'POST', '/students', async () => undefined)), 'passed');
    const ended = await tenant.sql(`SELECT 1 FROM audit_log WHERE action = 'app_view.ended' AND actor_membership_id = $1`, [tenant.ownerMembershipId]);
    assert.equal(ended.length, 1);
  });
});

test('what the list does not name is closed, and the office goes with it (QA 3, 13, 15)', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Nuno', 'Costa', ['instructor']);
    await tenant.sql(
      `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'admin')`,
      [tenant.organizationId, coach],
    );
    await withLogin(coach);
    const reader = await clerkOf(tenant.ownerMembershipId);
    await start(tenant, 'teaching', coach);

    const never = async (): Promise<void> => assert.fail('the handler ran');
    for (const url of [
      '/app/medical-leave',
      '/app/documents/fpn',
      `/students/${ID}/boletim`,
      `/students/${ID}/documents/fpn`,
      '/students',
      '/dashboard',
      '/staff',
      '/app/agenda/',
    ]) {
      assert.equal(await code(request(reader, 'GET', url, never)), 'viewing_as', url);
    }

    // Both an Admin and an instructor: viewed as an instructor, never as an Admin.
    await request(reader, 'GET', '/app/teaching', async () => {
      assert.deepEqual(currentTenant().roles, ['instructor']);
    });
  });
});

test('Sair works in a club that went read-only mid-view, and nothing else does', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardian } = await seedFamily(tenant);
    const reader = await clerkOf(tenant.ownerMembershipId);
    await start(tenant, 'family', guardian);
    await owner.query(`UPDATE organization SET read_only_at = now() WHERE id = $1`, [tenant.organizationId]);
    assert.equal(await code(request(reader, 'POST', '/students', async () => undefined)), 'tenant_read_only');
    await request(reader, 'POST', '/app-view/leave', () => new AppViewController().leave());
    const [row] = await tenant.sql<{ ended: Date | null }>(`SELECT ended_at AS ended FROM app_view`);
    assert.notEqual(row!.ended, null);
  });
});

test('viewed as Professor, a teacher’s own children are not on show', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardian } = await seedFamily(tenant);
    await tenant.sql(
      `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'instructor')`,
      [tenant.organizationId, guardian],
    );
    const reader = await clerkOf(tenant.ownerMembershipId);
    await start(tenant, 'teaching', guardian);
    const { students } = await request(reader, 'GET', '/family', () => new FamilyController().mine());
    assert.deepEqual(students, []);
  });
});

test('a deleted login ends the view and is not offered', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardian, clerk } = await seedFamily(tenant);
    const reader = await clerkOf(tenant.ownerMembershipId);
    await start(tenant, 'family', guardian);
    await owner.query(`UPDATE app_user SET deleted_at = now() WHERE clerk_user_id = $1`, [clerk]);
    await request(reader, 'POST', '/students', async () => {
      assert.equal(currentTenant().viewing, undefined, 'the reader is themselves again');
    });
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual((await new AppViewController().people('family')).people, []);
    });
  });
});

test('the logo and faces open for an owner, the logo alone for support (QA 12)', () => {
  const asView = <T>(support: boolean, fn: () => T): T =>
    tenantRun({ support, viewing: { id: ID, hat: 'family' } }, fn);

  assert.equal(asView(false, () => fileOpensInView('logo')), true);
  assert.equal(asView(false, () => fileOpensInView('student_photo')), true);
  assert.equal(asView(false, () => fileOpensInView('staff_photo')), true);
  assert.equal(asView(false, () => fileOpensInView('medical_certificate')), false);
  assert.equal(asView(false, () => fileOpensInView('student_id_document')), false);
  assert.equal(asView(false, () => fileOpensInView('student_document')), false);
  assert.equal(asView(true, () => fileOpensInView('logo')), true);
  assert.equal(asView(true, () => fileOpensInView('student_photo')), false);
  assert.equal(asView(true, () => fileOpensInView('staff_photo')), false);
  assert.equal(asView(true, () => instructorPhotoSql('iu', 'im')), 'NULL::text');
  assert.notEqual(asView(false, () => instructorPhotoSql('iu', 'im')), 'NULL::text');
  assert.equal(tenantRun({}, () => fileOpensInView('medical_certificate')), true, 'no view, no change');
});

test('who may view whom (QA 4, 5, 8, 10b)', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardian, clerk } = await seedFamily(tenant);
    const admin = await addMember(tenant, 'Ana', 'Gestora', ['admin']);
    const coach = await addMember(tenant, 'Nuno', 'Costa', ['instructor']);
    await withLogin(coach);
    const noLogin = await addMember(tenant, 'Rui', 'Sem', ['guardian']);
    const controller = new AppViewController();

    // An Admin and the Owner, even as somebody who teaches.
    await tenant.sql(
      `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'instructor')`,
      [tenant.organizationId, tenant.ownerMembershipId],
    );
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await expectStatus(() => controller.start({ hat: 'teaching', membershipId: tenant.ownerMembershipId }), 403);
      const { people } = await controller.people('teaching');
      assert.deepEqual(people.map((one) => one.membershipId), [coach], 'the Owner is not offered');
      await expectStatus(() => controller.history(), 403);
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // A login, and the home's role.
      await expectStatus(() => controller.start({ hat: 'family', membershipId: noLogin }), 404);
      await expectStatus(() => controller.start({ hat: 'teaching', membershipId: guardian }), 404);
      await expectStatus(() => controller.start({ hat: 'family', membershipId: tenant.ownerMembershipId }), 404);
      assert.deepEqual((await controller.people('family')).people.map((one) => one.membershipId), [guardian]);
      await expectStatus(() => controller.people('backoffice'), 400);
    });

    await withScratchTenant(async (club) => {
      await actingAs(club, { roles: ['owner'] }, () =>
        expectStatus(() => controller.start({ hat: 'family', membershipId: guardian }), 404),
      );
    });

    for (const roles of [['instructor'], ['guardian'], ['maintenance'], ['student']] as const) {
      await actingAs(tenant, { roles: [...roles] }, async () => {
        await expectStatus(() => controller.start({ hat: 'family', membershipId: guardian }), 403);
        await expectStatus(() => controller.people('family'), 403);
        await expectStatus(() => controller.leave(), 403);
      });
    }
    assert.ok(clerk.length > 0);
  });
});

test('Vistas da app and Atividade are the Owner’s; the person is not told (QA 7, rule 9)', async () => {
  await withScratchTenant(async (tenant) => {
    const login = await addMember(tenant, 'Carlos', 'Silva', ['student']);
    await withLogin(login);
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, 'Carlos', 'Silva', '1990-01-01', $2) RETURNING id`,
      [tenant.organizationId, login],
    );
    await start(tenant, 'family', login);

    const activity = new ActivityController();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { items: data } = await new AppViewController().history();
      assert.equal(data.length, 1);
      assert.equal(data[0]!.hat, 'family');
      assert.equal(data[0]!.support, false);
      const log = await activity.student(row!.id);
      assert.ok(log.items.some((one) => one.action === 'app_view.started'));
    });
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const log = await activity.student(row!.id);
      assert.equal(log.items.some((one) => one.action === 'app_view.started'), false);
    });

    // The person viewed hears nothing: no message, no aviso, no notice.
    const told = await tenant.sql(`SELECT 1 FROM message WHERE organization_id = $1`, [tenant.organizationId]);
    assert.equal(told.length, 0);
  });
});

test('a support view: bound to its grant, no personal aviso, on the record (QA 6, 17, 18)', async () => {
  await withScratchTenant(async (tenant) => {
    const login = await addMember(tenant, 'Carlos', 'Silva', ['student']);
    await withLogin(login);
    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id, contact_email)
       VALUES ($1, 'Carlos', 'Silva', '1990-01-01', $2, 'c@example.test')`,
      [tenant.organizationId, login],
    );
    const [student] = await tenant.sql<{ id: string }>(`SELECT id FROM student WHERE membership_id = $1`, [login]);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new StudentMessagesController().send(student!.id, {
        channel: 'email',
        subject: 'Exame médico',
        body: 'Marcado.',
        shownUntil: '2099-01-01',
      }),
    );
    const { membership, clerk } = await supportSession(tenant);

    await actingAs(tenant, { membershipId: membership, roles: ['admin'], support: true }, async () => {
      await expectStatus(() => new AppViewController().start({ hat: 'family', membershipId: login }), 400);
      await new AppViewController().start({ hat: 'family', membershipId: login, reason: 'Agenda vazia' });
    });

    const avisos = await request(clerk, 'GET', '/app/avisos', () => new AppAvisosController().mine());
    assert.equal(avisos.avisos.length, 0, 'an exam reminder stays out of a support view');
    await request(clerk, 'GET', '/app/agenda', async () => {
      assert.equal(currentTenant().support, true);
      assert.equal(currentTenant().membershipId, login);
    });

    // The reads stay out of the Owner's trail; the view does not.
    const trail = await actingAs(tenant, { roles: ['owner'] }, () => supportActivity(tenant.organizationId));
    assert.deepEqual(trail.map((one) => one.action), ['app_view.started']);
    const mine = await listSupportViews();
    assert.ok(mine.some((one) => one.reason === 'Agenda vazia' && one.organizationName === tenant.name));

    // An owner's own view shows the same aviso.
    const clerkPerson = await clerkOf(tenant.ownerMembershipId);
    await start(tenant, 'family', login);
    const shown = await request(clerkPerson, 'GET', '/app/avisos', () => new AppAvisosController().mine());
    assert.equal(shown.avisos.length, 1);

    // The grant runs out mid-view: the next request is nobody's, and certainly not a view.
    await owner.query(`UPDATE support_grant SET expires_at = now() - interval '1 second' WHERE organization_id = $1`, [tenant.organizationId]);
    assert.equal(await code(request(clerk, 'GET', '/app/agenda', async () => undefined)), 'no_organization');
  });
});

test('a list, not a prefix: every route of the API is closed unless it was chosen (QA 14)', () => {
  const chosen = new Set([
    'GET /shell',
    'GET /family',
    'GET /app/agenda',
    'GET /app/lessons/:id',
    'GET /app/lessons/:id/classmates',
    'GET /app/avisos',
    'GET /app/fees',
    'GET /app/documents',
    'GET /app/progress/:id',
    'GET /app/progress/:id/times',
    'GET /app/enrolment-requests',
    'GET /app/teaching',
    'GET /app/maintenance',
    'GET /sessions/:id/plan',
    'GET /sessions/:id/attendance',
    'GET /files/:id',
  ]);
  const opened = new Set<string>();

  const controllers = Reflect.getMetadata('controllers', AppModule) as Type[];
  assert.ok(controllers.length > 50);
  for (const controller of controllers) {
    const bases = [Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined].flat();
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const verb = RequestMethod[method]!;
      for (const base of bases) {
        for (const sub of [Reflect.getMetadata(PATH_METADATA, handler) as string | string[]].flat()) {
          const path = `/${[base ?? '', sub].map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
          const concrete = path.replace(/:[A-Za-z]+/g, ID);
          if (isViewLeave(verb, concrete)) continue;
          const route = viewReadRoute(verb, concrete);
          if (route === null) continue;
          const label = `${verb} ${route}`;
          assert.ok(chosen.has(label), `${verb} ${path} is open to a view and nobody chose it`);
          opened.add(label);
        }
      }
    }
  }
  assert.deepEqual([...chosen].filter((label) => !opened.has(label)), [], 'a listed route that no longer exists');
});

function tenantRun<T>(extra: Record<string, unknown>, fn: () => T): T {
  return tenantStorage.run(
    { organizationId: ID, membershipId: ID, appUserId: ID, roles: ['guardian'], ...extra },
    fn,
  );
}
