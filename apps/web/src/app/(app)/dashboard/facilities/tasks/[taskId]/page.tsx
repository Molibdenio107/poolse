import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { backTarget } from '@/lib/back';
import { getTask, listCompletions } from '../../maintenance.actions';
import { CompleteForm, RemoveCompletion, TaskAdmin } from './task-forms';

/**
 * One maintenance task, and the record of every time it was done.
 *
 * Slice 4.4's "who did what, when", arriving with 4.3 because a task cannot say
 * when it is next due without it.
 *
 * The same shape as a space's own page: a header that states the fact somebody
 * came for, the action, then the history. What is *not* here is an edit control
 * on a past entry — an entry is a claim about a moment, and editing one rewrites
 * what a colleague said they did. A mistake is deleted, which is owner/admin.
 */
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ from?: string; page?: string }>;
}): Promise<React.ReactElement> {
  const { taskId } = await params;
  const { from, page } = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();

  const requested = Number(page ?? '1');
  const [detail, history] = await Promise.all([
    getTask(taskId),
    listCompletions(taskId, Number.isFinite(requested) && requested > 0 ? requested : 1),
  ]);

  /*
   * A task belonging to another tenant is indistinguishable from one that does
   * not exist, deliberately — the difference is itself an answer about who else
   * uses this product. The space page folds 403 into 404 for the same reason.
   */
  if (detail === null) notFound();
  const { task } = detail;

  // Reached from the site's own page, which is where Voltar should land.
  const back = backTarget(from, `/dashboard/facilities/${task.facilityId}`);

  const target = task.spaceName ?? task.poolName ?? task.inventoryItemName;

  return (
    <PageShell
      title={task.title}
      subtitle={t('maintenance.everyDays', { days: task.intervalDays })}
      back={{ href: back.href, label: t(back.labelKey) }}
    >
      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-foreground-muted">{t('maintenance.about')}</dt>
            <dd className="text-sm">{target ?? t('maintenance.aboutSite')}</dd>
          </div>

          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-foreground-muted">{t('maintenance.assignee')}</dt>
            <dd className="text-sm">
              {task.assignedToName === null
                ? t('maintenance.unassigned')
                : task.assigneeArchived
                  ? t('maintenance.assigneeLeft', { name: task.assignedToName })
                  : task.assignedToName}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-foreground-muted">{t('maintenance.state')}</dt>
            {/*
              The state as words, computed by the server. Nothing here re-derives
              it — there is one implementation of that rule and it is in SQL.
            */}
            <dd className="text-sm">
              {task.state === 'paused'
                ? t('maintenance.paused')
                : task.state === 'due'
                  ? task.daysOverdue > 0
                    ? t('maintenance.dueBy', { days: task.daysOverdue })
                    : t('maintenance.due')
                  : t('maintenance.scheduled')}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-foreground-muted">{t('maintenance.nextDue')}</dt>
            <dd className="text-sm">
              {task.nextDueAt === null
                ? t('maintenance.neverDone')
                : format.dateTime(new Date(task.nextDueAt), 'stamp')}
            </dd>
          </div>
        </dl>

        {task.description !== null && (
          <p className="text-sm text-foreground-muted">{task.description}</p>
        )}
      </section>

      {detail.canComplete && task.state !== 'paused' && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('maintenance.recordTitle')}
          </h2>
          <CompleteForm facilityId={task.facilityId} taskId={task.id} />
        </section>
      )}

      <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('maintenance.history')}
        </h2>

        {history === null || history.items.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('maintenance.neverDone')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {history.items.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm">
                    {/* A named format, never an options object — see i18n.ts. */}
                    {t('maintenance.doneBy', {
                      name: entry.performedByName ?? '—',
                      when: format.dateTime(new Date(entry.performedAt), 'stamp'),
                    })}
                  </span>

                  {detail.canPlan && (
                    <RemoveCompletion
                      facilityId={task.facilityId}
                      taskId={task.id}
                      completionId={entry.id}
                    />
                  )}
                </div>

                {entry.note !== null && (
                  <span className="text-sm text-foreground-muted">{entry.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {history !== null && history.items.length > 0 && (
          <Pagination
            page={history}
            basePath={`/dashboard/facilities/tasks/${task.id}`}
            query={{ ...(from === undefined ? {} : { from }) }}
          />
        )}
      </section>

      {detail.canPlan && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('maintenance.plan')}
          </h2>
          <TaskAdmin task={task} assignees={detail.assignees ?? []} />
        </section>
      )}
    </PageShell>
  );
}
