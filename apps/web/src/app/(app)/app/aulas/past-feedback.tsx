import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronRight, MessageSquareText } from 'lucide-react';
import { apiFetch, type TaughtLessonFeedback } from '@/lib/api';
import { formatDayMonthShort } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { FeedbackList } from '@/components/feedback-list';

/**
 * What families said about the teacher's last seven lessons (Rui, 07-11-2026).
 * One row per lesson, folded; a lesson nobody wrote about says so and does not open.
 */
export async function PastFeedback(): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const locale = await getLocale();
  const loaded = await outcome(apiFetch<{ lessons: TaughtLessonFeedback[] }>('/app/teaching/feedback'));
  if (loaded.state === 'refused') return null;

  return (
    <section className="flex flex-col">
      <h2 className="app-section-label flex items-center gap-1.5">
        <MessageSquareText className="size-4" aria-hidden />
        {t('app.teaching.pastFeedback')}
      </h2>
      {loaded.state === 'failed' ? (
        <p className="text-sm text-foreground-muted">{t('app.teaching.pastFeedbackFailed')}</p>
      ) : loaded.data.lessons.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('app.teaching.pastFeedbackNone')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {loaded.data.lessons.map((lesson) => {
            const heading = (
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{lesson.className}</span>
                <span className="text-sm text-foreground-muted">
                  {formatDayMonthShort(lesson.lessonDate, locale)} · {lesson.localTime}
                </span>
              </span>
            );
            return (
              <li key={lesson.sessionId}>
                {lesson.feedback.length === 0 ? (
                  <div className="flex min-h-[52px] items-center justify-between gap-3 py-2">
                    {heading}
                    <span className="shrink-0 text-sm text-foreground-muted">{t('app.teaching.feedbackNone')}</span>
                  </div>
                ) : (
                  <details className="group">
                    <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      {heading}
                      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                        {t('app.teaching.feedbackCount', { count: lesson.feedback.length })}
                        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
                      </span>
                    </summary>
                    <div className="pb-3">
                      <FeedbackList items={lesson.feedback} by="student" canArchive={false} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
