import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { APP_TIME_ZONE } from './lib/date-format';

/** Duplicated from lib/preferences.ts to keep this module free of a cycle. */
const LOCALE_COOKIE = 'poolse-locale';

export const locales = ['pt-PT', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'pt-PT';

/**
 * i18n is wired before the first screen exists, on purpose. Every user-facing
 * string goes through the translation layer as it is written — retrofitting this
 * across a built application is the task that eats a whole weekend.
 *
 * There is no `/[locale]/` route segment: Poolse resolves the locale from the
 * signed-in user's preference, not from the URL. An operator and their instructor
 * share one tenant and may read different languages, and nobody wants to bookmark
 * `/pt-PT/turmas`.
 */
/**
 * The named date formats, defined once for both sides of the boundary.
 *
 * next-intl has no built-in `long` or `short`: asking for one that was never
 * configured throws `MISSING_FORMAT` at render time, which is how the lesson
 * plan panel came to break the calendar every time a turma was clicked. There is
 * nothing to catch that earlier — a format name is a string, so `typecheck` has
 * no opinion and the panel only renders once somebody opens it.
 *
 * Naming them here rather than repeating an options object at each call site is
 * also what makes a date the same shape wherever it appears. The two are the
 * same argument as `PX_PER_MINUTE`: one definition, or they drift.
 *
 * **Both places need them.** `getRequestConfig` covers server components;
 * `NextIntlClientProvider` in `(app)/layout.tsx` has to be handed the same
 * object, because in next-intl v3 a client provider inherits the locale and the
 * timezone from the server but not the messages or the formats.
 */
export const formats = {
  dateTime: {
    /*
     * `long`, `short` and `stamp` were here and are gone — 13 September 2026.
     *
     * Every date in Poolse is now `dd-MM-yyyy`, prose and `/admin` included, and
     * `Intl` cannot produce that shape: it has no separator option, `pt-PT`
     * writes 13/09/2026 and `en-US` writes 09/13/2026. So the single definition
     * moved to `lib/date-format.ts`, which builds it from `formatToParts`.
     *
     * They are **removed rather than left pointing at the old shape**: asking
     * for one now fails `check-formats.mjs` loudly, where leaving them would let
     * a new call site render slashes among the hyphens and nobody notice until a
     * screenshot.
     *
     * What stays is the two that are month *names* rather than dates, and those
     * are properly the reader's own language.
     */
    /**
     * A month, for a picker or a heading — "setembro de 2026" — F-17.
     *
     * Named here like every other shape, so no call site builds one from an
     * options object. It exists because a native `<input type="month">` renders
     * its label in the *browser's* locale and cannot be told otherwise: a
     * Portuguese interface showed "September 2026", and no amount of i18n on our
     * side could reach inside the control.
     */
    month: { year: 'numeric', month: 'long' },
    /** A month with no room for the year — the axis of a twelve-month chart: "set." */
    monthShort: { month: 'short' },
  },
} as const;

export default getRequestConfig(async () => {
  // The cookie, not `requestLocale`: with no `/[locale]/` segment there is
  // nothing in the URL for next-intl to read, so that argument is always
  // undefined and every page rendered in the default language. See
  // lib/preferences.ts for why the cookie is the request-time source and
  // `app_user.locale` the durable one.
  const requested = (await cookies()).get(LOCALE_COOKIE)?.value;
  const resolved = (locales as readonly string[]).includes(requested ?? '')
    ? (requested as Locale)
    : defaultLocale;

  return {
    locale: resolved,
    messages: (await import(`./messages/${resolved}.json`)).default,
    timeZone: APP_TIME_ZONE,
    formats,
  };
});
