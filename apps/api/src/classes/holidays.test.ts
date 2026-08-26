import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { easterSunday, holidaysBetween, portugueseHolidays } from './holidays.js';

/**
 * Easter drives four of the thirteen national holidays, and an off-by-one in the
 * computus would close the pool on the wrong Friday every spring — the kind of
 * error that looks like a typo in the calendar rather than a bug in the code.
 *
 * The dates below are the published Gregorian Easters, not values read back out
 * of this implementation. A test that asserts what the code already does proves
 * only that it is consistent.
 *
 * Run: pnpm --filter @poolse/api test
 */
describe('Portuguese holidays', () => {
  it('computes Easter Sunday', () => {
    const published: Record<number, string> = {
      2024: '2024-03-31',
      2025: '2025-04-20',
      2026: '2026-04-05',
      2027: '2027-03-28',
      2028: '2028-04-16',
      2029: '2029-04-01',
      2030: '2030-04-21',
      2031: '2031-04-13',
      2032: '2032-03-28',
    };

    for (const [year, expected] of Object.entries(published)) {
      assert.equal(
        easterSunday(Number(year)).toISOString().slice(0, 10),
        expected,
        `Easter ${year}`,
      );
    }
  });

  it('places the moveable feasts relative to Easter', () => {
    const holidays = portugueseHolidays(2027);
    const by = (name: string): string =>
      holidays.find((holiday) => holiday.name === name)?.date ?? '';

    // Easter 2027 is 28 March.
    assert.equal(by('Sexta-feira Santa'), '2027-03-26');
    assert.equal(by('Domingo de Páscoa'), '2027-03-28');
    assert.equal(by('Corpo de Deus'), '2027-05-27');
  });

  it('returns all thirteen national holidays, in date order', () => {
    const holidays = portugueseHolidays(2027);

    assert.equal(holidays.length, 13);
    const dates = holidays.map((holiday) => holiday.date);
    assert.deepEqual([...dates].sort(), dates, 'holidays are not in date order');
  });

  it('includes the fixed dates every year', () => {
    for (const year of [2026, 2027, 2028]) {
      const dates = new Set(portugueseHolidays(year).map((holiday) => holiday.date));
      for (const fixed of ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25']) {
        assert.ok(dates.has(`${year}-${fixed}`), `${year}-${fixed} missing`);
      }
    }
  });

  it('leaves out what is not a national holiday', () => {
    const names = portugueseHolidays(2027).map((holiday) => holiday.name);

    // Widely taken off, and a tolerância de ponto granted year by year rather
    // than a holiday — deciding it for an operator would be inventing policy.
    assert.ok(!names.includes('Carnaval'));
    // Municipal holidays vary by town and Poolse does not know which one a pool
    // is in: Lisbon takes 13 June, Porto takes 24 June.
    assert.ok(!names.some((name) => name.includes('Municipal')));
  });

  it('spans however many years a range covers', () => {
    // A season crossing the new year has to pick up both Christmases either side.
    const holidays = holidaysBetween('2027-09-01', '2028-07-31');
    const dates = holidays.map((holiday) => holiday.date);

    assert.ok(dates.includes('2027-12-25'), 'missed Christmas 2027');
    assert.ok(dates.includes('2028-01-01'), 'missed New Year 2028');
    assert.ok(dates.includes('2028-04-25'), 'missed 25 April 2028');

    // And nothing outside the window.
    assert.ok(!dates.includes('2027-08-15'), 'included a date before the range');
    assert.ok(!dates.includes('2028-08-15'), 'included a date after the range');
  });

  it('builds dates in UTC, so a machine in another timezone agrees', () => {
    // Constructed with Date.UTC rather than local parts: a server in Auckland
    // building `new Date(2027, 0, 1)` would produce 31 December.
    const first = portugueseHolidays(2027)[0];
    assert.equal(first?.date, '2027-01-01');
  });
});
