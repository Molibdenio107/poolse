import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import type { TaskList } from '@/lib/api';
import { withFrom } from '@/lib/back';

/**
 * "As minhas tarefas" — the roadmap's "a task appears for the right person".
 *
 * A server component with no controls on it, deliberately. Marking a job done
 * belongs where the job is — the site's list or the task's own page — and a
 * dashboard that could complete work would be a dashboard somebody presses by
 * accident on the way past.
 *
 * **Due first, and only what is actionable.** Paused tasks are already excluded
 * by the endpoint: this is a list of things to do today, and a suspended job is
 * not one. Unassigned tasks *are* included, because a job nobody has been given
 * still has to be visible to somebody — a club that assigns nothing would
 * otherwise see an empty panel and conclude the feature does not work.
 *
 * Absent rather than empty when there is nothing to show: a dashboard card
 * saying "nothing" is a card that costs a scroll on every load. It appears when
 * there is something, and the counts are in its heading so it can be read
 * without opening anything.
 */
export async function MyTasksPanel({
  list,
}: {
  list: TaskList;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();

  if (list.tasks.length === 0) return null;

  const due = list.tasks.filter((task) => task.state === 'due');

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('maintenance.mine')}
        </h2>
        <p className="text-sm text-foreground-muted">
          {t('maintenance.summary', { total: list.tasks.length, due: due.length })}
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded border border-border">
        {list.tasks.map((task) => (
          <li
            key={task.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3"
          >
            <span className="flex flex-wrap items-center gap-2">
              <Link
                href={withFrom(`/dashboard/facilities/tasks/${task.id}`, '/dashboard')}
                className="text-sm font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {task.title}
              </Link>

              {/*
                Icon and words together, never colour alone — the rule this app
                holds everywhere, and this is the one thing on the row somebody
                is meant to act on.
              */}
              {task.state === 'due' ? (
                <span className="inline-flex items-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  {task.daysOverdue > 0
                    ? t('maintenance.dueBy', { days: task.daysOverdue })
                    : t('maintenance.due')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  {t('maintenance.scheduled')}
                </span>
              )}
            </span>

            <span className="text-sm text-foreground-muted">
              {/*
                Which site, because somebody who works at two of them needs to
                know which building to walk to, and the club's name is the one
                thing this row cannot be read without.
              */}
              {task.facilityName}
              {task.assignedTo === null && ` · ${t('maintenance.unassigned')}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
