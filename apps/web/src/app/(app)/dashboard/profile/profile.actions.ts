'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ApiError, apiPut, type Me } from '../../../../lib/api';
import {
  isLocale,
  isTheme,
  localeCookieOptions,
  LOCALE_COOKIE,
  themeCookieOptions,
  THEME_COOKIE,
} from '../../../../lib/preferences';

export interface ProfileState {
  ok: boolean;
  /** Field name to translation key. Rendered beside the field, never as a banner. */
  fields?: Record<string, string>;
  /** Something that was nobody's fault in particular. */
  errorKey?: string;
  detail?: string;
  /**
   * Handed back so the form can apply it in the browser on the same click.
   *
   * The `dark` class lives on `<html>`, above the tree a server action
   * re-renders — see the note on `applyTheme`. Saving alone leaves the colours
   * where they were until a hard refresh.
   */
  theme?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Saves the profile, then makes this browser agree with it.
 *
 * The cookies matter as much as the API call. Language and theme render every
 * page from a cookie — the column is what makes the choice follow the person to
 * a second device, but it is the cookie that decides what this tab looks like on
 * the next paint. Saving the column alone would leave a person who just switched
 * to English still reading Portuguese until they signed in somewhere else.
 */
export async function saveProfileAction(
  _previous: ProfileState,
  form: FormData,
): Promise<ProfileState> {
  const locale = text(form, 'locale');
  const theme = text(form, 'theme');

  try {
    const saved = await apiPut<Me>('/me/profile', {
      firstName: text(form, 'firstName'),
      lastName: text(form, 'lastName'),
      birthDate: text(form, 'birthDate'),
      contactPhone: text(form, 'contactPhone'),
      locale,
      theme,
    });

    const store = await cookies();
    if (isLocale(saved.user.locale)) {
      store.set(LOCALE_COOKIE, saved.user.locale, localeCookieOptions);
    }
    if (isTheme(saved.user.theme)) {
      store.set(THEME_COOKIE, saved.user.theme, themeCookieOptions);
    }

    // Layout-deep: the language and the theme are read by the root layout, so
    // every page below it is now stale, not just this one.
    revalidatePath('/', 'layout');

    return { ok: true, theme: saved.user.theme };
  } catch (error) {
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
      return { ok: false, fields: error.fields };
    }
    return {
      ok: false,
      errorKey: 'profile.saveFailed',
      ...(error instanceof ApiError ? { detail: `${error.status} ${error.message}` } : {}),
    };
  }
}
