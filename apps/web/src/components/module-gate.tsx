import { getTranslations } from 'next-intl/server';
import type { PoolseModule } from '@poolse/rules';
import { moduleIsOn } from '@/lib/modules';
import { PageError, PageShell } from './page-shell';

/**
 * A module's pages, behind the club's switch — POOLSE-87.
 *
 * Mounted once in the `layout.tsx` of each module's route segment, so a page
 * reached by URL with its module off says so in a sentence rather than drawing
 * its own "not permitted" or an empty list. It is the courtesy, not the control:
 * every route behind these pages answers 403 `module_disabled` regardless.
 */
export async function ModuleGate({
  module,
  children,
}: {
  module: PoolseModule;
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  if (await moduleIsOn(module)) return <>{children}</>;

  const t = await getTranslations();
  return (
    <PageShell title={t(`modules.name.${module}`)}>
      <PageError message={t('common.moduleDisabled')} />
    </PageShell>
  );
}
