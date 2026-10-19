import { Cake } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { today as todayOfClub } from '@/lib/dates';

/**
 * "It is their birthday today" — round 4.
 *
 * A swimming school is mostly children, and the instructor who says happy
 * birthday at the poolside is the reason anybody remembers the club. That is the
 * whole feature: a small mark on the row, on the day.
 *
 * **Month and day only, never the year, and never a `Date` comparison.** The
 * dates involved are plain `YYYY-MM-DD` strings with no time and no zone — a
 * birth date is a calendar fact, not an instant — so this compares the last five
 * characters and nothing else. Building a `Date` from them would parse as
 * midnight UTC and shift the day backwards for anybody west of Greenwich, which
 * is the classic way this feature ships broken for half its users.
 *
 * **29 February is left alone deliberately.** Somebody born on a leap day has a
 * birthday on 29 February, and this marks it on 29 February. Whether a club
 * celebrates it on the 28th or the 1st in other years is a decision for the club
 * and not for a badge; inventing one here would put a cake on a row on a day the
 * person themselves might not agree with.
 *
 * Icon *and* text, because CLAUDE.md is explicit that colour never carries
 * meaning alone — and a cake glyph with no words is a colour with extra steps.
 */
export async function BirthdayFlag({
  birthDate,
}: {
  /** ISO `YYYY-MM-DD`, or null. */
  birthDate: string | null | undefined;
}): Promise<React.ReactElement | null> {
  if (!isBirthdayToday(birthDate)) return null;

  const t = await getTranslations();

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
      title={t('people.birthdayToday')}
    >
      <Cake aria-hidden className="size-3.5" />
      {t('people.birthdayToday')}
    </span>
  );
}

/**
 * Exported so a list can sort or count without rendering anything.
 *
 * Today is the club's day in `APP_TIME_ZONE`, never the runtime's: the server
 * runs in UTC, which put the cake on the wrong row for the first hour of every
 * Lisbon summer day. `sv-SE` is used only because it writes `YYYY-MM-DD`.
 */
export function isBirthdayToday(birthDate: string | null | undefined): boolean {
  if (birthDate === null || birthDate === undefined || birthDate.length < 10) return false;

  const today = todayOfClub().slice(5, 10);

  return birthDate.slice(5, 10) === today;
}
