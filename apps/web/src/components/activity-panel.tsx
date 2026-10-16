import { getTranslations } from 'next-intl/server';
import { loadActivity } from '@/app/(app)/dashboard/activity.actions';
import type { ActivityEntry } from '@/lib/api';
import { LABELLED_ACTIONS, formatActivityValue, type Translate } from '@/lib/activity';
import { formatDate, formatStamp } from '@/lib/date-format';
import { PageEmpty, PageError } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { RevertButton } from '@/components/revert-button';

/**
 * A record's *Atividade* tab — POOLSE-80.
 *
 * Who changed what, when, from what to what, newest first. A field the log
 * values shows both sides; a person's own data shows only that it changed,
 * because its values are never copied into the log. *Reverter* sits on an
 * entry that has something to put back; an older entry, written before the
 * log kept a "before", has none and says nothing about it.
 *
 * Owner and Admin only: the page passes `visible` from its `canManage`, and
 * the API refuses everybody else.
 */
export async function ActivityPanel({
  kind,
  id,
  page,
  basePath,
}: {
  kind: 'student' | 'class_group';
  id: string;
  page: number;
  basePath: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const loaded = await loadActivity(kind, id, page);

  if (loaded.state !== 'ok') {
    return (
      <PageError
        message={t((loaded.state === 'failed' ? loaded.failure.key : 'common.notAllowed') as never)}
      />
    );
  }
  const result = loaded.data;

  if (result.items.length === 0) {
    return <PageEmpty message={t('activity.empty')} hint={t('activity.emptyHint')} />;
  }

  const say: Translate = (key, values) => t(key as never, values as never);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('activity.title')}
      </h2>
      <ol className="flex flex-col divide-y divide-border">
        {result.items.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">{headline(say, entry, kind)}</p>
              <p className="text-sm text-foreground-muted">
                {t('activity.byWhen', {
                  who: entry.actor?.name ?? t('activity.system'),
                  when: formatStamp(entry.createdAt),
                })}
              </p>

              {entry.fields.length > 0 && (
                <dl className="flex flex-col gap-0.5 text-sm">
                  {entry.fields.map((field) => (
                    <div key={field.field} className="flex flex-wrap gap-x-2">
                      <dt className="text-foreground-muted">{say(`activity.field.${field.field}`)}</dt>
                      <dd>
                        {t('activity.fromTo', {
                          before: formatActivityValue(say, field.field, field.before),
                          after: formatActivityValue(say, field.field, field.after),
                        })}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {entry.withheld.length > 0 && (
                <p className="text-sm text-foreground-muted">
                  {t('activity.withheld', {
                    fields: entry.withheld.map((field) => say(`activity.field.${field}`)).join(', '),
                  })}
                </p>
              )}

              {entry.revertOf !== null && (
                <p className="text-sm text-foreground-muted">{t('activity.isRevert')}</p>
              )}
            </div>

            {entry.revertible && <RevertButton entryId={entry.id} />}
          </li>
        ))}
      </ol>
      <Pagination page={result} basePath={basePath} query={{ tab: 'activity' }} />
    </section>
  );
}

/** The line that says what happened: the action, or the class a mark belongs to. */
function headline(say: Translate, entry: ActivityEntry, kind: 'student' | 'class_group'): string {
  if (entry.action === 'attendance.changed' && entry.session !== null) {
    const date = formatDate(entry.session.date);
    return kind === 'class_group' && entry.student !== null
      ? say('activity.markFor', { name: entry.student.name, date })
      : say('activity.markOn', { date });
  }
  return LABELLED_ACTIONS.has(entry.action)
    ? say(`activity.action.${entry.action}`)
    : say('activity.action.other');
}

