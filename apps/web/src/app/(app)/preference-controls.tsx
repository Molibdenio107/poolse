import { getTranslations } from 'next-intl/server';
import { readTheme } from '../../lib/preferences';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

/**
 * The language and theme controls, together, because every screen header wants
 * both and neither has anywhere else to live yet. When the backoffice shell
 * arrives in phase 1 this moves into it and stops being repeated per page.
 */
export async function PreferenceControls({
  languageOnPhone = true,
}: {
  /**
   * False in the backoffice's top bar: on a phone the PT/EN pair squeezed the
   * club's name to "Clube …" (sweep 31-10-2026); language is also in O meu perfil.
   */
  languageOnPhone?: boolean;
} = {}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const theme = await readTheme();

  return (
    <>
      {languageOnPhone ? (
        <LocaleSwitcher />
      ) : (
        <span className="contents max-sm:hidden">
          <LocaleSwitcher />
        </span>
      )}
      <ThemeToggle label={t('theme.label')} theme={theme} />
    </>
  );
}
