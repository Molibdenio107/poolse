'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronRight, Globe, SunMoon } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { applyTheme } from '@/lib/apply-theme';
import { THEMES, type Theme } from '@/lib/theme';
import { setLocaleAction, setThemeAction } from '../../preferences.actions';

/**
 * *Idioma* and *Tema* as two plain rows — Rui, 31-10-2026. Each says its
 * current answer and opens a sheet of the choices (`placement="sheet"`, a
 * bottom sheet on a phone); one tap chooses and closes. The same two server
 * actions the backoffice's controls use, so the choice follows the person.
 */
export function PreferenceRows({
  locale,
  locales,
  theme,
}: {
  locale: string;
  locales: readonly string[];
  theme: Theme;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState<'locale' | 'theme' | null>(null);
  const [themeNow, setThemeNow] = useState<Theme>(theme);
  const [, startTransition] = useTransition();

  function chooseLocale(next: string): void {
    setOpen(null);
    const form = new FormData();
    form.set('locale', next);
    startTransition(() => setLocaleAction(form));
  }

  function chooseTheme(next: Theme): void {
    setOpen(null);
    setThemeNow(next);
    applyTheme(next);
    const form = new FormData();
    form.set('theme', next);
    startTransition(() => setThemeAction(form));
  }

  const row =
    'flex min-h-[52px] w-full items-center justify-between gap-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  return (
    <>
      <li>
        <button type="button" className={row} onClick={() => setOpen('locale')}>
          <span className="flex items-center gap-3">
            <Globe className="size-5 text-primary" aria-hidden />
            {t('locale.label')}
          </span>
          <span className="flex items-center gap-1 text-foreground-muted">
            {t(`locale.${locale}`)}
            <ChevronRight className="size-4" aria-hidden />
          </span>
        </button>
      </li>
      <li>
        <button type="button" className={row} onClick={() => setOpen('theme')}>
          <span className="flex items-center gap-3">
            <SunMoon className="size-5 text-primary" aria-hidden />
            {t('theme.label')}
          </span>
          <span className="flex items-center gap-1 text-foreground-muted">
            {t(`theme.option.${themeNow}`)}
            <ChevronRight className="size-4" aria-hidden />
          </span>
        </button>
      </li>

      <Dialog
        open={open === 'locale'}
        onClose={() => setOpen(null)}
        title={t('locale.label')}
        closeLabel={t('common.close')}
        placement="sheet"
      >
        <Choices
          options={locales.map((value) => ({ value, label: t(`locale.${value}`) }))}
          current={locale}
          onChoose={chooseLocale}
        />
      </Dialog>

      <Dialog
        open={open === 'theme'}
        onClose={() => setOpen(null)}
        title={t('theme.label')}
        closeLabel={t('common.close')}
        placement="sheet"
      >
        <Choices
          options={THEMES.map((value) => ({ value, label: t(`theme.option.${value}`) }))}
          current={themeNow}
          onChoose={(value) => chooseTheme(value as Theme)}
        />
      </Dialog>
    </>
  );
}

/** The sheet's list: a row per answer, the one in force ticked — never colour alone. */
function Choices({
  options,
  current,
  onChoose,
}: {
  options: { value: string; label: string }[];
  current: string;
  onChoose: (value: string) => void;
}): React.ReactElement {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {options.map((option) => (
        <li key={option.value}>
          <button
            type="button"
            aria-pressed={option.value === current}
            onClick={() => onChoose(option.value)}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span className={option.value === current ? 'font-semibold' : undefined}>{option.label}</span>
            {option.value === current && <Check className="size-5 text-primary" aria-hidden />}
          </button>
        </li>
      ))}
    </ul>
  );
}
