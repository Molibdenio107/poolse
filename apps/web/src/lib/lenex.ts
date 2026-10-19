import { inflateRawSync } from 'node:zlib';

/**
 * Reading a LENEX results file — POOLSE-81.
 *
 * LENEX is swimming's open XML format: Splash Meet Manager writes it, the FPN
 * sends it, swimrankings serves it. A `.lef` is the XML; a `.lxf` is a zip
 * holding exactly one `.lef`. This turns either into the field names the API's
 * preview takes, and decides nothing else — which club is ours, who is matched,
 * what is skipped and what is a new best are the server's.
 *
 * **Deterministic, no model, no flag.** Bytes in, the same answer out.
 *
 * **The file comes from outside the club**, so the reader is built to refuse
 * rather than to cope:
 * - no general XML parser — a small reader that takes elements and attributes
 *   and nothing else, and refuses any `<!DOCTYPE` or `<!ENTITY` outright, so no
 *   entity can be expanded and no external one fetched;
 * - only the five predefined entities and numeric character references are
 *   decoded;
 * - a `.lxf` must hold exactly one `.lef`; nested archives are refused; and the
 *   inflated size is capped, so a 10 MB upload cannot become a gigabyte.
 *
 * Read on the Next server, never in the browser, and never sent anywhere but
 * the club's own API.
 */

/** The upload ceiling — the ticket's 10 MB. */
export const LENEX_MAX_BYTES = 10 * 1024 * 1024;
/** What a `.lxf` may inflate to. A real results file is a few MB of XML. */
export const LENEX_MAX_INFLATED_BYTES = 40 * 1024 * 1024;

export type LenexCourse = 'scm' | 'lcm';
export type LenexStroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'medley';

export interface LenexResult {
  /** The event's number in the programme — half of the re-import key. */
  eventNumber: number;
  /** TIM, PRE, SEM, FIN… — the other half: a heat and a final are two results. */
  round: string;
  /** Mapped, or null for a stroke outside Poolse's five (the server counts it). */
  stroke: LenexStroke | null;
  distanceM: number;
  relayCount: number;
  /** The session's course, else the meet's; null for yards or anything unknown. */
  course: LenexCourse | null;
  /** The raw course, so the server can tell yards from missing. */
  rawCourse: string;
  /** The session's date. */
  swumOn: string | null;
  /** Integer milliseconds, or null for NT or no time. */
  timeMs: number | null;
  /** DSQ, DNS, DNF, WDR… or '' for a swim that counted. */
  status: string;
}

export interface LenexAthlete {
  /** The athlete's id inside this file — the preview's handle for a decision. */
  key: string;
  clubCode: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  gender: string | null;
  licence: string | null;
  results: LenexResult[];
}

export interface LenexClub {
  code: string;
  name: string;
  athletes: number;
}

export interface LenexFile {
  meet: {
    name: string;
    city: string | null;
    course: LenexCourse | null;
    startsOn: string | null;
    endsOn: string | null;
  };
  clubs: LenexClub[];
  athletes: LenexAthlete[];
}

/** Why a file was refused, as a catalogue key the screen translates. */
export class LenexError extends Error {
  // A plain field rather than a parameter property: this file runs under
  // node's type stripping in the tests, which does not support those.
  readonly key: string;

  constructor(key: string) {
    super(key);
    this.key = key;
  }
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/**
 * `HH:MM:SS.hh` to integer milliseconds — the one conversion. Shorter forms
 * (`MM:SS.hh`, `SS.hh`) are read too. `NT`, an empty value or an all-zero time
 * is no time: null, never zero, because a zero would be everybody's best.
 */
export function lenexTimeToMs(value: string | null | undefined): number | null {
  const raw = (value ?? '').trim();
  if (raw === '' || /^nt$/i.test(raw)) return null;
  const match = /^(?:(?:(\d{1,2}):)?(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,3}))?$/.exec(raw);
  if (match === null) return null;
  const [, hours = '0', minutes = '0', seconds = '0', fraction = ''] = match;
  // Hundredths are the sport's resolution; a third digit is kept as given.
  const ms =
    fraction === '' ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3));
  const total =
    Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000 + ms;
  return total > 0 ? total : null;
}

const STROKES: Record<string, LenexStroke> = {
  FREE: 'freestyle',
  BACK: 'backstroke',
  BREAST: 'breaststroke',
  FLY: 'butterfly',
  MEDLEY: 'medley',
};

function courseOf(raw: string | undefined): LenexCourse | null {
  const value = (raw ?? '').trim().toUpperCase();
  return value === 'SCM' ? 'scm' : value === 'LCM' ? 'lcm' : null;
}

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

/**
 * The one `.lef` inside a `.lxf`, inflated under the cap. Reads the zip's
 * central directory itself — a few dozen lines, and the limits stay in this
 * file rather than in a library's defaults.
 */
export function unzipLenex(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record, searched from the end (a comment may follow it).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new LenexError('meets.import.error.notZip');

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const found: { name: string; method: number; compressed: number; size: number; local: number }[] = [];

  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new LenexError('meets.import.error.notZip');
    }
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    found.push({ name, method, compressed, size, local });
  }

  if (found.some((entry) => /\.(lxf|zip)$/i.test(entry.name))) {
    throw new LenexError('meets.import.error.nested');
  }
  const lefs = found.filter((entry) => /\.lef$/i.test(entry.name));
  if (lefs.length !== 1) throw new LenexError('meets.import.error.oneLef');
  const entry = lefs[0]!;
  if (entry.size > LENEX_MAX_INFLATED_BYTES) throw new LenexError('meets.import.error.tooBig');

  const localNameLength = view.getUint16(entry.local + 26, true);
  const localExtraLength = view.getUint16(entry.local + 28, true);
  const start = entry.local + 30 + localNameLength + localExtraLength;
  const data = bytes.subarray(start, start + entry.compressed);

  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new LenexError('meets.import.error.notZip');
  try {
    // The cap is enforced by zlib itself, so a lying size header cannot get past it.
    return inflateRawSync(data, { maxOutputLength: LENEX_MAX_INFLATED_BYTES });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new LenexError('meets.import.error.tooBig');
    }
    throw new LenexError('meets.import.error.notZip');
  }
}

// ---------------------------------------------------------------------------
// The XML
// ---------------------------------------------------------------------------

interface Element {
  name: string;
  attributes: Record<string, string>;
  children: Element[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    const known = ENTITIES[body.toLowerCase()];
    // Anything else is not defined here, and nothing defines it: refused.
    if (known === undefined) throw new LenexError('meets.import.error.entity');
    return known;
  });
}

/**
 * Elements and attributes, nothing else. Text content, comments and
 * processing instructions are skipped; a DOCTYPE or an ENTITY is refused.
 */
export function readLenexXml(text: string): Element {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new LenexError('meets.import.error.entity');

  const root: Element = { name: '#root', attributes: {}, children: [] };
  const stack: Element[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g;
  const attribute = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  let match: RegExpExecArray | null;
  while ((match = tag.exec(text)) !== null) {
    const [whole, closing, name, attrs, selfClosing] = match;
    if (name === undefined) continue; // a comment, PI or CDATA
    if (whole.startsWith('<!') || whole.startsWith('<?')) continue;

    if (closing === '/') {
      const open = stack.pop();
      if (open === undefined || open.name.toUpperCase() !== name.toUpperCase() || stack.length === 0) {
        throw new LenexError('meets.import.error.notLenex');
      }
      continue;
    }

    const element: Element = { name: name.toUpperCase(), attributes: {}, children: [] };
    attribute.lastIndex = 0;
    let pair: RegExpExecArray | null;
    while ((pair = attribute.exec(attrs ?? '')) !== null) {
      element.attributes[pair[1]!.toLowerCase()] = decode(pair[2] ?? pair[3] ?? '');
    }
    stack[stack.length - 1]!.children.push(element);
    if (selfClosing !== '/') stack.push(element);
  }

  if (stack.length !== 1) throw new LenexError('meets.import.error.notLenex');
  return root;
}

function all(element: Element, name: string): Element[] {
  const found: Element[] = [];
  const walk = (node: Element): void => {
    for (const child of node.children) {
      if (child.name === name) found.push(child);
      else walk(child);
    }
  };
  walk(element);
  return found;
}

function first(element: Element, name: string): Element | undefined {
  return all(element, name)[0];
}

function day(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** A `.lef` or a `.lxf`, by its bytes (a zip starts with `PK`). */
export function parseLenex(bytes: Uint8Array): LenexFile {
  if (bytes.length > LENEX_MAX_BYTES) throw new LenexError('meets.import.error.tooBig');
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const xmlBytes = isZip ? unzipLenex(bytes) : bytes;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);

  const root = readLenexXml(text);
  const lenex = first(root, 'LENEX');
  const meet = lenex === undefined ? undefined : first(lenex, 'MEET');
  if (meet === undefined) throw new LenexError('meets.import.error.notLenex');

  const meetCourse = meet.attributes['course'];

  // Every event, by its id, with the session it is swum in.
  const events = new Map<string, Omit<LenexResult, 'timeMs' | 'status'>>();
  const sessionDays: string[] = [];
  for (const session of all(meet, 'SESSION')) {
    const swumOn = day(session.attributes['date']);
    if (swumOn !== null) sessionDays.push(swumOn);
    const rawCourse = session.attributes['course'] ?? meetCourse ?? '';
    for (const event of all(session, 'EVENT')) {
      const style = first(event, 'SWIMSTYLE');
      const id = event.attributes['eventid'];
      if (id === undefined || style === undefined) continue;
      events.set(id, {
        eventNumber: Number(event.attributes['number'] ?? 0) || 0,
        round: (event.attributes['round'] ?? 'TIM').toUpperCase().slice(0, 20),
        stroke: STROKES[(style.attributes['stroke'] ?? '').toUpperCase()] ?? null,
        distanceM: Number(style.attributes['distance'] ?? 0) || 0,
        relayCount: Number(style.attributes['relaycount'] ?? 1) || 1,
        course: courseOf(rawCourse),
        rawCourse: rawCourse.toUpperCase(),
        swumOn,
      });
    }
  }
  sessionDays.sort();

  const clubs: LenexClub[] = [];
  const athletes: LenexAthlete[] = [];
  for (const club of all(meet, 'CLUB')) {
    const code = (club.attributes['code'] ?? club.attributes['name'] ?? '').trim();
    const members = all(club, 'ATHLETE');
    clubs.push({ code, name: (club.attributes['name'] ?? code).trim(), athletes: members.length });

    for (const athlete of members) {
      const results: LenexResult[] = [];
      for (const result of all(athlete, 'RESULT')) {
        const event = events.get(result.attributes['eventid'] ?? '');
        if (event === undefined) continue;
        results.push({
          ...event,
          timeMs: lenexTimeToMs(result.attributes['swimtime']),
          status: (result.attributes['status'] ?? '').trim().toUpperCase(),
        });
      }
      athletes.push({
        key: `${code}:${athlete.attributes['athleteid'] ?? athletes.length}`,
        clubCode: code,
        firstName: (athlete.attributes['firstname'] ?? '').trim(),
        lastName: (athlete.attributes['lastname'] ?? '').trim(),
        birthDate: day(athlete.attributes['birthdate']),
        gender: athlete.attributes['gender'] ?? null,
        licence: (athlete.attributes['license'] ?? '').trim() || null,
        results,
      });
    }
  }

  return {
    meet: {
      name: (meet.attributes['name'] ?? '').trim(),
      city: (meet.attributes['city'] ?? '').trim() || null,
      course: courseOf(meetCourse),
      startsOn: sessionDays[0] ?? null,
      endsOn: sessionDays[sessionDays.length - 1] ?? null,
    },
    clubs,
    athletes,
  };
}
