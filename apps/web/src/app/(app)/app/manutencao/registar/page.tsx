import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { apiFetch, type MaintenanceHome } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { RegistarPicker } from './registar-picker';

/**
 * *Registar* — POOLSE-181. Three rows: *Concluir tarefa* and *Limpeza* open a
 * sheet of what is open, each item the same one-tap form *Hoje* uses
 * (`one-tap.tsx`), so there is one action per thing and not two; *Reportar
 * avaria* opens the existing form, which comes back here.
 *
 * Read from `/app/maintenance`, the endpoint *Hoje* reads, so both tabs always
 * agree on what is open. A water analysis is still recorded in the pool's water
 * tab (POOLSE-90 slice 3), so it is not a row here.
 */
export default async function MaintenanceRecordPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let home: MaintenanceHome;
  try {
    home = await apiFetch<MaintenanceHome>('/app/maintenance');
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const row =
    'flex min-h-control w-full items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3 text-left shadow-card hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.maintenance.record.title')}</h1>
      <ul className="flex flex-col gap-2">
        <li>
          <RegistarPicker
            kind="complete"
            label={t('app.maintenance.record.complete')}
            hint={t('app.maintenance.tasks', { count: home.tasks.length })}
            empty={t('app.maintenance.record.nothingToComplete')}
            closeLabel={t('common.close')}
            items={home.tasks.map((task) => ({
              id: task.id,
              name: task.title,
              detail: [task.facilityName, task.spaceName ?? task.poolName ?? task.inventoryItemName]
                .filter(Boolean)
                .join(' · '),
              actionLabel: t('app.maintenance.completeNamed', { name: task.title }),
            }))}
          />
        </li>
        <li>
          <RegistarPicker
            kind="clean"
            label={t('app.maintenance.record.clean')}
            hint={t('app.maintenance.toClean', { count: home.overdueSpaces.length })}
            empty={t('app.maintenance.record.nothingToClean')}
            closeLabel={t('common.close')}
            items={home.overdueSpaces.map((space) => ({
              id: space.id,
              name: space.name,
              detail: space.facilityName,
              actionLabel: t('app.maintenance.cleanNamed', { name: space.name }),
            }))}
          />
        </li>
        <li>
          <Link href="/app/manutencao/reportar?from=registar" className={row}>
            <span className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" aria-hidden />
              {t('app.maintenance.record.report')}
            </span>
            <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
            <LinkBusy />
          </Link>
        </li>
      </ul>
    </>
  );
}
