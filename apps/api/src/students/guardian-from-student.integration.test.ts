import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PeopleSearchController, StudentsController } from './students.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * An adult student picked as a child's encarregado — 14-11-2026.
 *
 * Rui searched the guardian picker for Sara Alves, 30, enrolled as a student
 * with no login, and found nobody: the picker searched people (memberships),
 * and a student without a login has none. The office's only way on was to type
 * her again, which makes a second Sara Alves.
 *
 * Now the picker also offers adult students with no person, and saving one as a
 * guardian makes her person from her student file and links the two.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('an adult student with no login is found by the guardian picker and becomes one person', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();
      const search = new PeopleSearchController();

      const { id: saraId } = await students.create({
        firstName: 'Sara',
        lastName: 'Alves',
        birthDate: '1996-06-07',
        contactEmail: 'sara.alves@exemplo.pt',
      });
      // A child the club has no business offering as anybody's guardian.
      await students.create({
        firstName: 'Sara',
        lastName: 'Pequena',
        birthDate: '2018-02-02',
        guardians: [{ name: 'Ana Pequena', relationship: 'mãe', email: 'ana.p@exemplo.pt' }],
      });

      // An instructor is not offered students outside their sports — nor any here.
      await actingAs(tenant, { roles: ['instructor'] }, async () => {
        const asInstructor = await new PeopleSearchController().search('Sara', '1');
        assert.equal(asInstructor.people.some((person) => person.studentId !== null), false);
      });

      // Reception's search is unchanged: people only.
      const desk = await search.search('Sara');
      assert.equal(desk.people.some((person) => person.studentId !== null), false);

      const found = await search.search('sara alv', '1');
      const sara = found.people.find((person) => person.studentId === saraId);
      assert.ok(sara, 'the adult student is offered');
      assert.equal(sara.membershipId, null);
      assert.equal(sara.email, 'sara.alves@exemplo.pt');
      const minors = await search.search('Pequena', '1');
      assert.equal(minors.people.some((person) => person.name === 'Sara Pequena'), false);

      const { id: childId } = await students.create({
        firstName: 'Tomás',
        lastName: 'Alves',
        birthDate: '2017-09-09',
        guardians: [
          {
            membershipId: null,
            studentId: saraId,
            name: sara.name,
            email: sara.email,
            relationship: 'mãe',
          },
        ],
      });

      const [linked] = await tenant.sql<{ membership_id: string | null }>(
        `SELECT membership_id FROM student WHERE id = $1`,
        [saraId],
      );
      assert.ok(linked?.membership_id, 'the student now has a person');

      const child = await students.one(childId);
      assert.equal(child.guardians.length, 1);
      assert.equal(child.guardians[0]!.membershipId, linked.membership_id);

      const [count] = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM membership WHERE email = 'sara.alves@exemplo.pt'`,
      );
      assert.equal(count!.n, 1, 'one Sara Alves, not two');

      // Found again as a person now, not as a student.
      const again = await search.search('sara alv', '1');
      assert.equal(again.people.filter((person) => person.name.startsWith('Sara Alves')).length, 1);
      assert.equal(again.people[0]!.membershipId, linked.membership_id);
    });
  });
});
