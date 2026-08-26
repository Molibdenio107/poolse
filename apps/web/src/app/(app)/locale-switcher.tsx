import { getLocale, getTranslations } from 'next-intl/server';
import { locales } from '../../i18n';
import { setLocaleAction } from './preferences.actions';

const SHORT: Record<string, string> = {
  'pt-PT': 'PT',
  en: 'EN',
};

/**
 * Two languages, so two buttons rather than a select: a dropdown to choose
 * between two things is a click more than it needs to be. This becomes a select
 * on the third locale, and the `locales` array is what decides.
 *
 * A server component — it needs no interactivity beyond submitting, and the
 * whole point of writing the preference server-side is that the next render is
 * already correct.
 */
export async function LocaleSwitcher(): Promise<React.ReactElement> {
  const active = await getLocale();
  const t = await getTranslations();

  return (
    <div className="flex items-center rounded border border-border bg-surface" role="group" aria-label={t('locale.label')}>
      {locales.map((locale) => (
        <form key={locale} action={setLocaleAction}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            aria-current={locale === active ? 'true' : undefined}
            aria-label={t(`locale.${locale}`)}
            className={`px-2.5 py-1.5 text-sm transition-colors first:rounded-l last:rounded-r focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              locale === active
                ? 'bg-primary/15 text-primary'
                : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground'
            }`}
          >
            {SHORT[locale] ?? locale}
          </button>
        </form>
      ))}
    </div>
  );
}
