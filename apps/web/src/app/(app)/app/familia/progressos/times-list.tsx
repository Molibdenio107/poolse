'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Medal } from 'lucide-react';
import { formatSwimTime } from '@poolse/rules';
import type { ProgressTime } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { moreTimesAction } from './progress.actions';
import { RemoveTime } from './progress-forms';

/**
 * Every time, a page at a time. The next page comes as the end of the list nears
 * the screen, so a phone never carries a long history it did not scroll to, and
 * the page itself scrolls: no box inside a box to catch a thumb. The button is the
 * same request, for a reader whose browser cannot watch the scroll.
 */
export function TimesList({
  studentId,
  first,
  total,
  canRemove,
}: {
  studentId: string;
  first: ProgressTime[];
  total: number;
  canRemove: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [times, setTimes] = useState(first);
  const [ended, setEnded] = useState(false);
  const [pending, start] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const more = times.length < total && !ended;

  const load = (): void => {
    if (pending) return;
    start(async () => {
      const next = await moreTimesAction(studentId, times.length);
      if (next.length === 0) setEnded(true);
      else setTimes((shown) => [...shown, ...next]);
    });
  };

  useEffect(() => {
    const end = sentinel.current;
    if (end === null || !more || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load();
    }, { rootMargin: '300px' });
    watch.observe(end);
    return () => watch.disconnect();
    // `load` closes over `times`, which this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more, times.length, pending]);

  if (times.length === 0) {
    return (
      <p className="flex items-center gap-2 text-foreground-muted">
        <Medal className="size-4" aria-hidden />
        {t('app.records.none')}
      </p>
    );
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {times.map((record) => {
          const line = t('app.records.event', {
            distance: record.distanceM,
            stroke: t(`progress.strokes.${record.stroke}`),
          });
          const details = [
            formatDate(record.swumOn),
            record.lessonName,
            record.meetName,
            record.official ? t('app.records.official') : null,
          ].filter((part) => part !== null);
          return (
            <li key={record.id} className="flex items-center justify-between gap-3 py-1">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {line} · {formatSwimTime(record.timeMs)}
                </span>
                <span className="text-sm text-foreground-muted">{details.join(' · ')}</span>
              </span>
              {record.selfReported && canRemove && <RemoveTime studentId={studentId} entry={record.id} name={line} />}
            </li>
          );
        })}
      </ul>
      {more && (
        <div ref={sentinel} className="pt-2">
          <button
            type="button"
            onClick={load}
            disabled={pending}
            className="inline-flex h-control w-full items-center justify-center rounded-sm text-control text-primary disabled:opacity-60"
          >
            {pending ? t('common.working') : t('app.records.more', { shown: times.length, total })}
          </button>
        </div>
      )}
    </>
  );
}
