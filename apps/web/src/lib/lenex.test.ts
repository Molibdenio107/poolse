import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  LENEX_MAX_INFLATED_BYTES,
  LenexError,
  lenexTimeToMs,
  parseLenex,
} from './lenex.ts';

/**
 * POOLSE-81 — reading a LENEX results file, and refusing the ones built to hurt.
 *
 * The fixtures are written here, by hand, in the shape Splash Meet Manager
 * writes: a meet, its sessions and events, then every club with its athletes and
 * their results. Real club files never enter the repository.
 */

const LEF = `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0">
  <MEETS>
    <MEET name="Torneio de Inverno &amp; Natal" city="Santo Tirso" course="LCM" nation="POR">
      <SESSIONS>
        <SESSION number="1" date="2026-12-12">
          <EVENTS>
            <EVENT eventid="10" number="3" round="PRE" gender="F">
              <SWIMSTYLE distance="100" relaycount="1" stroke="FREE" />
            </EVENT>
            <EVENT eventid="11" number="3" round="FIN" gender="F">
              <SWIMSTYLE distance="100" relaycount="1" stroke="FREE" />
            </EVENT>
            <EVENT eventid="12" number="5" round="TIM">
              <SWIMSTYLE distance="50" relaycount="4" stroke="MEDLEY" />
            </EVENT>
          </EVENTS>
        </SESSION>
        <SESSION number="2" date="2026-12-13" course="SCM">
          <EVENTS>
            <EVENT eventid="20" number="8" round="TIM">
              <SWIMSTYLE distance="200" relaycount="1" stroke="BACK" />
            </EVENT>
          </EVENTS>
        </SESSION>
      </SESSIONS>
      <CLUBS>
        <CLUB name="Clube de Santo Tirso" code="CST" nation="POR">
          <ATHLETES>
            <ATHLETE athleteid="1" firstname="Inês" lastname="Sousa" birthdate="2012-04-03" gender="F" license="204117">
              <RESULTS>
                <RESULT resultid="1" eventid="10" swimtime="00:01:02.34" />
                <RESULT resultid="2" eventid="11" swimtime="00:01:01.90" />
                <RESULT resultid="3" eventid="20" swimtime="NT" status="DNS" />
              </RESULTS>
            </ATHLETE>
          </ATHLETES>
        </CLUB>
        <CLUB name="Outro Clube" code="OUT">
          <ATHLETES>
            <ATHLETE athleteid="2" firstname="Rui" lastname="Silva" birthdate="2011-01-01" gender="M" />
          </ATHLETES>
        </CLUB>
      </CLUBS>
    </MEET>
  </MEETS>
</LENEX>`;

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A zip of the given files, deflated, as a `.lxf` is. */
function zip(files: Record<string, Uint8Array>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

function refusedWith(fn: () => unknown, key: string): void {
  assert.throws(fn, (error: unknown) => error instanceof LenexError && error.key === key);
}

test('times convert to integer milliseconds at the edges, and NT is no time', () => {
  assert.equal(lenexTimeToMs('00:01:02.34'), 62340);
  assert.equal(lenexTimeToMs('00:00:27.05'), 27050, 'under a minute');
  assert.equal(lenexTimeToMs('01:02:03.45'), 3723450, 'over an hour');
  assert.equal(lenexTimeToMs('1:02.34'), 62340, 'the short form');
  assert.equal(lenexTimeToMs('NT'), null);
  assert.equal(lenexTimeToMs(''), null);
  assert.equal(lenexTimeToMs('00:00:00.00'), null, 'a zero would be everybody’s best');
  assert.equal(lenexTimeToMs('garbage'), null);
});

test('a .lef reads the meet, every club, and each result with its session’s day and course', () => {
  const file = parseLenex(bytes(LEF));
  assert.deepEqual(file.meet, {
    name: 'Torneio de Inverno & Natal',
    city: 'Santo Tirso',
    course: 'lcm',
    startsOn: '2026-12-12',
    endsOn: '2026-12-13',
  });
  assert.deepEqual(
    file.clubs.map((club) => [club.code, club.athletes]),
    [['CST', 1], ['OUT', 1]],
  );

  const ines = file.athletes.find((athlete) => athlete.licence === '204117')!;
  assert.equal(ines.firstName, 'Inês');
  assert.equal(ines.birthDate, '2012-04-03');
  assert.deepEqual(
    ines.results.map((result) => [result.eventNumber, result.round, result.timeMs, result.course, result.swumOn]),
    [
      [3, 'PRE', 62340, 'lcm', '2026-12-12'],
      [3, 'FIN', 61900, 'lcm', '2026-12-12'],
      // A session's course overrides the meet's.
      [8, 'TIM', null, 'scm', '2026-12-13'],
    ],
  );
  assert.equal(ines.results[2]!.status, 'DNS');
});

test('a .lxf holding one .lef reads the same as the .lef', () => {
  const file = parseLenex(zip({ 'results.lef': bytes(LEF) }));
  assert.equal(file.meet.name, 'Torneio de Inverno & Natal');
  assert.equal(file.athletes.length, 2);
});

test('refused: a DTD with an external entity, two .lef files, a nested archive, an oversize inflate', () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE lenex [<!ENTITY x SYSTEM "file:///etc/passwd">]><LENEX><MEETS><MEET name="&x;"/></MEETS></LENEX>`;
  refusedWith(() => parseLenex(bytes(evil)), 'meets.import.error.entity');
  refusedWith(
    () => parseLenex(bytes('<LENEX><MEETS><MEET name="&undefined;"/></MEETS></LENEX>')),
    'meets.import.error.entity',
  );
  refusedWith(
    () => parseLenex(zip({ 'a.lef': bytes(LEF), 'b.lef': bytes(LEF) })),
    'meets.import.error.oneLef',
  );
  refusedWith(
    () => parseLenex(zip({ 'a.lef': bytes(LEF), 'inner.lxf': zip({ 'c.lef': bytes(LEF) }) })),
    'meets.import.error.nested',
  );
  // A small zip that would inflate past the cap, its header claiming a small size.
  const bomb = zip({ 'bomb.lef': new Uint8Array(LENEX_MAX_INFLATED_BYTES + 1024) });
  const lying = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
  const central = bomb.length - 22 - 46 - 'bomb.lef'.length;
  lying.setUint32(central + 24, 1000, true);
  refusedWith(() => parseLenex(bomb), 'meets.import.error.tooBig');
  refusedWith(() => parseLenex(bytes('<html><body>not a meet</body></html>')), 'meets.import.error.notLenex');
});
