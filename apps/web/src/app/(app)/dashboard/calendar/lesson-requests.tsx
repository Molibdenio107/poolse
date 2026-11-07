import { getTranslations } from 'next-intl/server';
import { UserRoundX } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { LessonRequestSeen } from './lesson-request-seen';

interface LessonRequest {
  id: string;
  sessionId: string;
  kind: 'substitute' | 'cancelled';
  note: string | null;
  requestedBy: string;
  className: string;
  localDate: string;
  localTime: string;
}

/**
 * What teachers have asked of the office — POOLSE-198. On top of the calendar,
 * because that is where the circle leads. A request for cover closes by naming a
 * stand-in on the lesson's page; a cancellation by *Visto*. Drawn only when there
 * is something to answer.
 */
export async function LessonRequests(): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const loaded = await outcome(apiFetch<{ requests: LessonRequest[] }>('/lesson-requests'));
  if (loaded.state !== 'ok' || loaded.data.requests.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded bg-surface p-4 shadow-card">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <UserRoundX className="size-4 text-foreground-muted" aria-hidden />
        {t('calendar.requests.title')}
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {loaded.data.requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">
                {t(request.kind === 'substitute' ? 'calendar.requests.cover' : 'calendar.requests.cancelled', {
                  name: request.requestedBy,
                })}
              </span>
              <span className="text-sm text-foreground-muted">
                {[request.className, formatDate(request.localDate), request.localTime].join(' · ')}
              </span>
              {request.note !== null && <span className="text-sm text-foreground-muted">{request.note}</span>}
            </div>
            {request.kind === 'substitute' ? (
              <FromLink
                href={`/dashboard/calendar/sessions/${request.sessionId}`}
                className="text-sm text-primary underline-offset-2 hover:underline"
              >
                {t('calendar.requests.assign')}
              </FromLink>
            ) : (
              <LessonRequestSeen id={request.id} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
