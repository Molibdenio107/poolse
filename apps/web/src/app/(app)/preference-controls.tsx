import { getTranslations } from 'next-intl/server';
import { readTheme } from '../../lib/preferences';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

/**
 * The language and theme controls, together, because every screen header wants
 * both and neither has anywhere else to live yet. When the backoffice shell
 * arrives in phase 1 this moves into it and stops being repeated per page.
 */
export async function PreferenceControls(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const theme = await readTheme();

  return (
    <>
      <LocaleSwitcher />
      <ThemeToggle label={t('theme.toggle')} theme={theme} />
    </>
  );
}
