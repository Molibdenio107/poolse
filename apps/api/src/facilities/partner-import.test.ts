import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseKey,
  previewPartners,
  readPartnerType,
  type ExistingPartner,
  type PartnerImportContext,
  type RawPartnerRow,
} from './partner-import.js';

/**
 * Importing partnerships — POOLSE-48.
 *
 * **One row is one group, not one partner**, and almost every case here is that
 * sentence from a different angle. A school's sheet has a row per class with the
 * school's name repeating down the column; reading it the way the register reads
 * a repeated name would produce twelve schools called the same thing, each with
 * one class, and a preview saying "eleven duplicates".
 *
 * The other half is what a *repeat of a group* means. That one behaves like the
 * inventory: it is a stocktake, reported with the old and new counts, and the
 * operator decides.
 *
 * Run: pnpm api:test
 */

const EMPTY: PartnerImportContext = { existing: [], levels: [] };

function rows(...list: RawPartnerRow[]): RawPartnerRow[] {
  return list;
}

test('twelve rows across three schools are three partners with twelve groups', () => {
  // 48.1, and the reason this module exists.
  const file = rows(
    ...['6A', '6B', '10G 11B', '11H/I'].map((groupName) => ({
      partnerName: 'ES D. Dinis',
      groupName,
      participantCount: '24',
    })),
    ...['Hidroterapia', 'Lar'].map((groupName) => ({
      partnerName: 'Misericórdia de Santo Tirso',
      groupName,
      participantCount: '8',
    })),
    ...['Sub-14', 'Sub-16'].map((groupName) => ({
      partnerName: 'Andebol Clube',
      groupName,
      participantCount: '18',
    })),
  );

  const { partners, summary } = previewPartners(file, EMPTY);

  assert.equal(partners.length, 3);
  assert.deepEqual(
    partners.map((p) => p.name),
    ['ES D. Dinis', 'Misericórdia de Santo Tirso', 'Andebol Clube'],
  );
  assert.deepEqual(partners.map((p) => p.rows.length), [4, 2, 2]);

  // The button's promise: three partnerships and eight classes, not eight rows.
  assert.equal(summary.partnersToCreate, 3);
  assert.equal(summary.groupsToCreate, 8);
  assert.equal(summary.refused, 0);
});

test('a repeated partner name is never reported as a duplicate', () => {
  /*
   * The trap the ticket names. On the register a second row for a child is a
   * mistake; here it is the normal case, and a preview flagging it would read as
   * eleven problems on a perfectly good file.
   */
  const { rows: read, summary } = previewPartners(
    rows(
      { partnerName: 'ES D. Dinis', groupName: '6A' },
      { partnerName: 'ES D. Dinis', groupName: '6B' },
      { partnerName: 'ES D. Dinis', groupName: '6C' },
    ),
    EMPTY,
  );

  assert.equal(summary.refused, 0);
  for (const row of read) {
    assert.equal(row.repeatOfLine, null);
    assert.equal(row.importable, true);
  }
});

test('a repeated group on the same partner is a repeat, and only the first counts', () => {
  const { rows: read, summary } = previewPartners(
    rows(
      { partnerName: 'ES D. Dinis', groupName: '6A', participantCount: '24' },
      { partnerName: 'ES D. Dinis', groupName: '6a', participantCount: '31' },
    ),
    EMPTY,
  );

  // Case only, because that is all the database's index folds. The second row is
  // the same class typed twice, and the file says which line it came from.
  assert.equal(read[0]!.repeatOfLine, null);
  assert.equal(read[1]!.repeatOfLine, 2);
  assert.equal(read[1]!.importable, false);
  assert.equal(summary.groupsToCreate, 1);
});

test('the same group name under two different schools is two groups', () => {
  // `6A` at one school is not `6A` at another, and keying on the group name
  // alone would silently merge two schools' classes.
  const { summary } = previewPartners(
    rows(
      { partnerName: 'ES D. Dinis', groupName: '6A' },
      { partnerName: 'ES Tomaz Pelayo', groupName: '6A' },
    ),
    EMPTY,
  );

  assert.equal(summary.partnersToCreate, 2);
  assert.equal(summary.groupsToCreate, 2);
});

test('the awkward class names normalise exactly as the database does', () => {
  /*
   * `10G 11B`, `11H/I` and `12 F/I` are the reference sheet's own names and the
   * reason POOLSE-55 keeps them. The rule is `lower(strip_accents(name))` and
   * nothing else, because that is what `partner_group_name_uq` is on.
   *
   * **`11H/I` and `11H I` are two different classes here**, and that is the
   * point: the first version of this flattened punctuation, which would have
   * offered a club a stocktake merging them and overwritten one class's
   * headcount with the other's. Being stricter than the database is visible;
   * being looser destroys data quietly.
   */
  assert.equal(normaliseKey('11H/I'), normaliseKey('11h/i'));
  assert.notEqual(normaliseKey('11H/I'), normaliseKey('11H I'));
  assert.notEqual(normaliseKey('11H/I'), normaliseKey('12 F/I'));
  assert.notEqual(normaliseKey('10G 11B'), normaliseKey('10G 11C'));

  // Accents fold, because two people type "Misericórdia" two ways.
  assert.equal(normaliseKey('Misericórdia'), normaliseKey('misericordia'));

  const { summary } = previewPartners(
    rows(
      { partnerName: 'ES D. Dinis', groupName: '10G 11B' },
      { partnerName: 'ES D. Dinis', groupName: '11H/I' },
      { partnerName: 'ES D. Dinis', groupName: '12 F/I' },
    ),
    EMPTY,
  );
  assert.equal(summary.groupsToCreate, 3);
});

const DINIS: ExistingPartner = {
  id: 'partner-1',
  name: 'ES D. Dinis',
  type: 'escola',
  groups: [
    {
      id: 'group-1',
      name: '6A',
      participantCount: 24,
      tag: 'DE',
      ownInstructorName: null,
      levelId: null,
      notes: null,
    },
  ],
};

test('an existing partner gains groups rather than being duplicated', () => {
  // 48.2 and criterion 4 — matched accent- and case-insensitively.
  const { partners, summary } = previewPartners(
    rows(
      { partnerName: 'es d. dinis', groupName: '6A', participantCount: '24' },
      { partnerName: 'ES D. DINIS', groupName: '6B', participantCount: '22' },
    ),
    { existing: [DINIS], levels: [] },
  );

  assert.equal(partners.length, 1);
  assert.equal(partners[0]!.isNew, false);
  assert.equal(partners[0]!.partnerId, 'partner-1');
  assert.equal(summary.partnersToCreate, 0);
  assert.equal(summary.partnersExisting, 1);

  // One of the two classes is already recorded; the other is new.
  assert.equal(summary.groupsExisting, 1);
  assert.equal(summary.groupsToCreate, 1);
});

test('a group already recorded reads as a stocktake, 24 to 31', () => {
  // 48.3.
  const { rows: read, summary } = previewPartners(
    rows({ partnerName: 'ES D. Dinis', groupName: '6A', participantCount: '31' }),
    { existing: [DINIS], levels: [] },
  );

  const row = read[0]!;
  assert.equal(row.existing, true);
  assert.equal(row.groupId, 'group-1');
  assert.deepEqual(row.updates, [
    { field: 'participantCount', before: '24', after: '31' },
  ]);
  assert.equal(summary.groupsToUpdate, 1);
  // And it is still importable — a stocktake is a choice, not a refusal.
  assert.equal(row.importable, true);
});

test('re-importing an unchanged file changes nothing', () => {
  // 48.2's second half. Every row is a stocktake and none of them updates
  // anything, so committing with nothing ticked is a no-op by construction.
  const { summary } = previewPartners(
    rows({ partnerName: 'ES D. Dinis', groupName: '6A', participantCount: '24', tag: 'DE' }),
    { existing: [DINIS], levels: [] },
  );

  assert.equal(summary.groupsExisting, 1);
  assert.equal(summary.groupsToUpdate, 0);
  assert.equal(summary.groupsToCreate, 0);
});

test('a blank cell is silence, never an instruction to clear', () => {
  /*
   * The one that would quietly destroy data. A sheet without a Notas column
   * must not empty the notes on every group it touches — "the file did not say"
   * and "set this to nothing" are different, and only one of them is in a
   * spreadsheet.
   */
  const withNotes: ExistingPartner = {
    ...DINIS,
    groups: [{ ...DINIS.groups[0]!, notes: 'Entra pela rampa', tag: 'DE' }],
  };

  const { rows: read } = previewPartners(
    rows({ partnerName: 'ES D. Dinis', groupName: '6A', participantCount: '24' }),
    { existing: [withNotes], levels: [] },
  );

  assert.deepEqual(read[0]!.updates, []);
});

test('a headcount column that is missing is zero, and says so', () => {
  // 48.7. A sheet listing which classes come is worth having.
  const { rows: read, summary } = previewPartners(
    rows({ partnerName: 'ES D. Dinis', groupName: '6A' }),
    EMPTY,
  );

  assert.equal(read[0]!.participantCount, 0);
  assert.equal(read[0]!.importable, true);
  assert.deepEqual(
    read[0]!.warnings.map((w) => w.code),
    ['countMissing'],
  );
  assert.equal(summary.groupsToCreate, 1);
});

test('a count written the way a spreadsheet writes one', () => {
  const { rows: read } = previewPartners(
    rows(
      { partnerName: 'A', groupName: '1', participantCount: ' 24 ' },
      { partnerName: 'A', groupName: '2', participantCount: '24 alunos' },
      { partnerName: 'A', groupName: '3', participantCount: '1,0' },
      { partnerName: 'A', groupName: '4', participantCount: 'muitos' },
    ),
    EMPTY,
  );

  assert.equal(read[0]!.participantCount, 24);
  assert.equal(read[1]!.participantCount, 24);
  assert.equal(read[2]!.participantCount, 1);
  // A count that is not a count is the one thing in this column that refuses.
  assert.deepEqual(read[3]!.problems.map((p) => p.code), ['badCount']);
  assert.equal(read[3]!.importable, false);
});

test('the type is read the way a person writes it', () => {
  // 48.4.
  assert.equal(readPartnerType('Misericórdia'), 'ipss_misericordia');
  assert.equal(readPartnerType('IPSS'), 'ipss_misericordia');
  assert.equal(readPartnerType('Santa Casa'), 'ipss_misericordia');
  assert.equal(readPartnerType('jardim de infância'), 'jardim_infancia');
  assert.equal(readPartnerType('JI'), 'jardim_infancia');
  assert.equal(readPartnerType('Câmara Municipal'), 'camara');
  assert.equal(readPartnerType('clube'), 'clube');

  // The one that would go wrong on ordering alone: "agrupamento de escolas"
  // contains "escolas", and the exact pass is what stops `escola` claiming it.
  assert.equal(readPartnerType('Agrupamento de Escolas'), 'agrupamento');
  assert.equal(readPartnerType('Escola Secundária'), 'escola');
});

test('an unrecognised type imports as outro with a warning, and is not refused', () => {
  // 48.5.
  const { rows: read, summary } = previewPartners(
    rows({ partnerName: 'Qualquer', partnerType: 'qualquer coisa', groupName: 'A' }),
    EMPTY,
  );

  assert.equal(read[0]!.partnerType, 'outro');
  assert.equal(read[0]!.importable, true);
  assert.ok(read[0]!.warnings.some((w) => w.code === 'unknownType'));
  assert.equal(summary.refused, 0);
});

test('no type column at all warns about nothing', () => {
  // The commonest file there is. A warning on every row of it would be noise.
  const { rows: read } = previewPartners(
    rows({ partnerName: 'ES D. Dinis', groupName: '6A' }),
    EMPTY,
  );
  assert.ok(!read[0]!.warnings.some((w) => w.code === 'unknownType'));
});

test('a type that disagrees with the recorded one is a warning, and the record wins', () => {
  // A club that set IPSS on the Misericórdia last season meant it. A spreadsheet
  // saying "outro" should not overwrite that, but it should be mentioned.
  const { rows: read } = previewPartners(
    rows({ partnerName: 'ES D. Dinis', partnerType: 'clube', groupName: '6B' }),
    { existing: [DINIS], levels: [] },
  );

  assert.equal(read[0]!.partnerType, 'escola');
  assert.ok(read[0]!.warnings.some((w) => w.code === 'typeConflict'));
  assert.equal(read[0]!.importable, true);
});

test('a row missing either name is refused with a named cause', () => {
  // 48.6.
  const { rows: read, summary } = previewPartners(
    rows(
      { partnerName: 'ES D. Dinis' },
      { groupName: '6A' },
      { partnerName: 'ES D. Dinis', groupName: '6A' },
    ),
    EMPTY,
  );

  assert.deepEqual(read[0]!.problems.map((p) => p.code), ['groupRequired']);
  assert.deepEqual(read[1]!.problems.map((p) => p.code), ['partnerRequired']);
  assert.equal(summary.refused, 2);
  assert.equal(summary.importable, 1);

  // And a refused row files under no partnership, so the button never promises
  // to create a school on the strength of a line it cannot write.
  assert.equal(summary.partnersToCreate, 1);
});

test('a level that matches nothing is a warning, not a refusal', () => {
  const context: PartnerImportContext = {
    existing: [],
    levels: [{ id: 'level-1', name: 'Iniciação' }],
  };

  const { rows: read } = previewPartners(
    rows(
      { partnerName: 'A', groupName: '1', levelName: 'iniciacao' },
      { partnerName: 'A', groupName: '2', levelName: 'Nível de 2019' },
    ),
    context,
  );

  // Accent- and case-insensitive, like everything else that matches by name.
  assert.equal(read[0]!.levelId, 'level-1');
  assert.equal(read[1]!.levelId, null);
  assert.ok(read[1]!.warnings.some((w) => w.code === 'levelNotFound'));
  assert.equal(read[1]!.importable, true);
});

test('an address that is not an address is flagged and kept', () => {
  const { rows: read } = previewPartners(
    rows({ partnerName: 'A', groupName: '1', contactEmail: 'ana(at)escola.pt' }),
    EMPTY,
  );

  assert.ok(read[0]!.warnings.some((w) => w.code === 'badEmail'));
  assert.equal(read[0]!.importable, true);
});

test('the summary counts what a commit would do, not what the file contains', () => {
  const { summary } = previewPartners(
    rows(
      { partnerName: 'ES D. Dinis', groupName: '6A', participantCount: '31' },
      { partnerName: 'ES D. Dinis', groupName: '6B' },
      { partnerName: 'Andebol Clube', groupName: 'Sub-16' },
      { partnerName: 'Andebol Clube' },
    ),
    { existing: [DINIS], levels: [] },
  );

  assert.equal(summary.total, 4);
  assert.equal(summary.refused, 1);
  assert.equal(summary.importable, 3);
  assert.equal(summary.partnersToCreate, 1);
  assert.equal(summary.partnersExisting, 1);
  assert.equal(summary.groupsToCreate, 2);
  assert.equal(summary.groupsExisting, 1);
  assert.equal(summary.groupsToUpdate, 1);
});
