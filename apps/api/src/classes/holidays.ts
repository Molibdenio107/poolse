export interface Holiday {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Portuguese name — this is a Portuguese product and these are its holidays. */
  name: string;
}

/**
 * The Portuguese national holidays for a year.
 *
 * Nine are fixed dates. Four move with Easter, which is why this is computed
 * rather than a list somebody has to extend every December — and why those four
 * cannot be stored as annually-recurring closures: Carnaval is a different date
 * every year, so a rule matching on month and day would be wrong in twelve
 * months out of thirteen.
 *
 * These become closures automatically, per the operator's decision to have
 * Poolse close on them without asking. Each one is a visible, deletable closure
 * rather than an invisible rule, because plenty of municipal pools open on the
 * 5th of October — and when a class disappears from the calendar, the operator
 * needs to be able to see what removed it and put it back.
 *
 * Not included: Carnaval. It is not a national holiday in Portugal, however
 * widely it is taken off — that is a *tolerância de ponto* granted year by year,
 * and deciding it on an operator's behalf would be inventing policy. They can
 * add it as an ordinary closure.
 *
 * Municipal holidays are not included either, for the same reason: Lisbon takes
 * the 13th of June and Porto the 24th, and Poolse does not know which town a
 * pool is in.
 */
const FIXED: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: 'Ano Novo' },
  { month: 4, day: 25, name: 'Dia da Liberdade' },
  { month: 5, day: 1, name: 'Dia do Trabalhador' },
  { month: 6, day: 10, name: 'Dia de Portugal' },
  { month: 8, day: 15, name: 'Assunção de Nossa Senhora' },
  { month: 10, day: 5, name: 'Implantação da República' },
  { month: 11, day: 1, name: 'Todos os Santos' },
  { month: 12, day: 1, name: 'Restauração da Independência' },
  { month: 12, day: 8, name: 'Imaculada Conceição' },
  { month: 12, day: 25, name: 'Natal' },
];

/**
 * Easter Sunday, by the anonymous Gregorian algorithm.
 *
 * Reproduced rather than approximated: the date of Easter is defined by a
 * computus, not by a rule of thumb, and "the first Sunday after the first full
 * moon following the equinox" is not something to implement from the
 * description. Every intermediate here is integer arithmetic on purpose.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  // UTC throughout: this is a calendar date, and building it in local time would
  // let a machine set to Auckland move Easter by a day.
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shift(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function portugueseHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);

  const holidays: Holiday[] = [
    ...FIXED.map((entry) => ({
      date: isoDate(new Date(Date.UTC(year, entry.month - 1, entry.day))),
      name: entry.name,
    })),
    { date: isoDate(shift(easter, -2)), name: 'Sexta-feira Santa' },
    { date: isoDate(easter), name: 'Domingo de Páscoa' },
    // Corpus Christi: the Thursday sixty days after Easter.
    { date: isoDate(shift(easter, 60)), name: 'Corpo de Deus' },
  ];

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

/** Every holiday between two dates, across however many years they span. */
export function holidaysBetween(from: string, to: string): Holiday[] {
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));

  const all: Holiday[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    all.push(...portugueseHolidays(year));
  }

  return all.filter((holiday) => holiday.date >= from && holiday.date <= to);
}
