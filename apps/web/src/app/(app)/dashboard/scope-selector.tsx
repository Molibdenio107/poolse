'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { rememberScopeAction } from './scope.actions';

/**
 * Which site the management band is about — POOLSE-66 AC 10.
 *
 * Only offered to the band's readers (the API sends the list to nobody else) and
 * only where there is a choice to make: a club with one site has nothing to
 * select. The choice is remembered on the server, so the next visit opens on
 * it; the operational band below ignores it, because "my work today" is not a
 * question about a site.
 */
export function ScopeSelector({
  sites,
  value,
}: {
  sites: { id: string; name: string }[];
  /** The site the page is showing, or null for every site. */
  value: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function choose(next: string): void {
    startTransition(async () => {
      const result = await rememberScopeAction(next === '' ? null : next);
      if (!result.ok) toast.show('danger', t('common.notSaved'));
    });
  }

  return (
    <div className="flex min-w-40 max-w-field flex-col gap-1.5">
      <label htmlFor="dashboard-scope" className="text-sm text-foreground-muted">
        {t('dashboard.scope.label')}
      </label>
      <select
        id="dashboard-scope"
        value={value ?? ''}
        disabled={pending}
        aria-busy={pending}
        onChange={(event) => choose(event.target.value)}
        className="h-control rounded border border-border-strong bg-background px-2.5 text-control disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <option value="">{t('dashboard.scope.all')}</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </div>
  );
}
