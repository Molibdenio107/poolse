import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { StaffNotesController } from './staff-notes.controller.js';
import { DashboardController } from '../dashboard/dashboard.controller.js';
import { ArchiveController } from '../archive/archive.controller.js';
import type { StaffNotesWidget } from '../dashboard/resolvers.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import type { MemberRole } from '../tenant/roles.js';

/**
 * The staff's post-it board — POOLSE-169 (Rui, 04-11-2026), against the real
 * database. Any working role pins a note every other one reads, at the top of
 * the Painel; it stays until its author or the office takes it down, and it is
 * never edited.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const notes = new StaffNotesController();

const as = <T>(tenant: ScratchTenant, membershipId: string, roles: MemberRole[], fn: () => Promise<T>) =>
  actingAs(tenant, { membershipId, roles }, fn);

function boardOn(page: unknown): StaffNotesWidget | null {
  const widgets = (page as { bands: { widgets: { id: string; data: unknown }[] }[] }).bands.flatMap(
    (band) => band.widgets,
  );
  return (widgets.find((one) => one.id === 'staff.notes')?.data as StaffNotesWidget | undefined) ?? null;
}

test('169 — maintenance pins a note; every working role sees it first on the Painel; a family never does', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Reis', ['maintenance']);
    const prof = await addMember(tenant, 'Prof', 'Água', ['instructor']);
    const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);

    await as(tenant, joao, ['maintenance'], () => notes.pin({ body: 'Bomba 2 parada até sexta.', colour: 'orange' }));

    for (const [who, roles] of [
      [prof, ['instructor']],
      [tenant.ownerMembershipId, ['owner']],
      [joao, ['maintenance']],
    ] as const) {
      const page = await as(tenant, who, [...roles], () => new DashboardController().read());
      assert.equal(page.bands[0]!.id, 'notes', `${roles[0]}: the board is first`);
      const board = boardOn(page)!;
      assert.equal(board.notes.length, 1);
      assert.equal(board.notes[0]!.body, 'Bomba 2 parada até sexta.');
      assert.equal(board.notes[0]!.colour, 'orange');
      assert.equal(board.notes[0]!.authorName, 'João Reis');
    }

    const family = await as(tenant, mother, ['guardian'], () => new DashboardController().read());
    assert.equal(JSON.stringify(family).includes('staff.notes'), false, 'absent from the raw payload');
    assert.equal(JSON.stringify(family).includes('Bomba 2'), false);
  });
});

test('169 — an empty board is still drawn for staff: it is where a note is written', async () => {
  await withScratchTenant(async (tenant) => {
    const prof = await addMember(tenant, 'Prof', 'Água', ['instructor']);
    const page = await as(tenant, prof, ['instructor'], () => new DashboardController().read());
    assert.deepEqual(boardOn(page)?.notes, []);
  });
});

test('169 — the author or the office takes a note down; nobody else; the bin brings it back', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Reis', ['maintenance']);
    const prof = await addMember(tenant, 'Prof', 'Água', ['instructor']);
    const admin = await addMember(tenant, 'Ana', 'Office', ['admin']);

    const { id: mine } = await as(tenant, joao, ['maintenance'], () => notes.pin({ body: 'Do João' }));
    const { id: other } = await as(tenant, joao, ['maintenance'], () => notes.pin({ body: 'Outra do João' }));

    const seenByProf = await as(tenant, prof, ['instructor'], () => notes.list());
    assert.equal(seenByProf.notes.every((one) => !one.canRemove), true, 'not theirs: no control');
    await as(tenant, prof, ['instructor'], () => expectStatus(() => notes.remove(mine), 403));

    const own = await as(tenant, joao, ['maintenance'], () => notes.remove(mine));
    assert.equal(own.undoable, false, 'the bin is the office’s');

    const byOffice = await as(tenant, admin, ['admin'], () => notes.remove(other));
    assert.equal(byOffice.undoable, true);
    assert.deepEqual((await as(tenant, prof, ['instructor'], () => notes.list())).notes, []);

    await as(tenant, admin, ['admin'], () => new ArchiveController().restore(own.archiveEntryId));
    const back = await as(tenant, prof, ['instructor'], () => notes.list());
    assert.deepEqual(back.notes.map((one) => one.body), ['Do João']);

    await as(tenant, admin, ['admin'], () => expectStatus(() => notes.remove(other), 404));
  });
});

test('169 — words and colour are checked; a note is never edited', async () => {
  await withScratchTenant(async (tenant) => {
    const prof = await addMember(tenant, 'Prof', 'Água', ['instructor']);
    await as(tenant, prof, ['instructor'], () => expectStatus(() => notes.pin({ body: '   ' }), 400));
    await as(tenant, prof, ['instructor'], () => expectStatus(() => notes.pin({ body: 'x'.repeat(501) }), 400));
    await as(tenant, prof, ['instructor'], () => expectStatus(() => notes.pin({ body: 'x', colour: 'red' }), 400));

    const { id } = await as(tenant, prof, ['instructor'], () => notes.pin({ body: 'Sem cor' }));
    const listed = await as(tenant, prof, ['instructor'], () => notes.list());
    assert.equal(listed.notes.find((one) => one.id === id)?.colour, 'yellow', 'yellow unless chosen');

    // The app login holds no UPDATE on the words — a correction is a new note.
    await assert.rejects(
      tenant.sql(`UPDATE staff_note SET body = 'mudado' WHERE id = $1`, [id]),
      /permission denied/,
    );
  });
});
