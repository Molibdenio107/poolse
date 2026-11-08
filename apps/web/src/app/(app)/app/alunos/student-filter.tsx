'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

/** Narrows the list by name as the teacher types; the address keeps it for *Voltar*. */
export function StudentFilter({ initial }: { initial: string }): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (value === initial) return;
    const timer = window.setTimeout(() => {
      const wanted = value.trim();
      router.replace(wanted === '' ? pathname : `${pathname}?q=${encodeURIComponent(wanted)}`, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, initial, pathname, router]);

  return (
    <label className="flex h-control items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline focus-within:outline-2 focus-within:outline-primary">
      <Search className="size-4 shrink-0 text-foreground-muted" aria-hidden />
      <span className="sr-only">{t('app.teaching.studentsFilter')}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('app.teaching.studentsFilter')}
        className="min-w-0 flex-1 bg-transparent text-control outline-none"
      />
    </label>
  );
}
