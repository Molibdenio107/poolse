import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronRight, MessageSquareText } from 'lucide-react';
import type { FamilyFeedback, RecentLesson } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { LinkBusy } from '@/components/link-busy';
import { MoodFace } from '@/components/mood';
import { dayHeading } from './agenda-parts';
import { FeedbackForm } from './feedback-form';

/**
 * How a lesson went, for a family — POOLSE-116.
 *
 * The lesson page shows one panel per child in it: the form while the window is
 * open and this reader answers for them, the answer read-only otherwise, and in
 * words why there is nothing to answer — a lesson not marked yet, missed,
 * cancelled or still running. The API decided each state; this only says it.
 */
export async function FeedbackPanel({
  sessionId,
  standing,
  named,
}: {
  sessionId: string;
  standing: FamilyFeedback;
  /** Siblings share this lesson: say whose panel it is. */
  named: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { state, feedback } = standing;

  let body: React.ReactNode;
  if (state === 'open' && standing.mayAnswer) {
    body = (
      <>
        <FeedbackForm
          sessionId={sessionId}
          studentId={standing.studentId}
          mood={feedback?.mood ?? null}
          comment={feedback?.comment ?? null}
        />
        <p className="text-sm text-foreground-muted">
          {t('app.feedback.editableUntil', { date: formatDate(standing.closesOn) })}
        </p>
      </>
    );
  } else if (state === 'open' || state === 'closed') {
    body = (
      <>
        {feedback === null ? (
          <p className="text-sm text-foreground-muted">
            {state === 'open' ? t('app.feedback.noneYet') : t('app.feedback.none')}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <MoodFace mood={feedback.mood} className="font-medium" />
            {feedback.comment !== null && <p className="whitespace-pre-wrap">{feedback.comment}</p>}
          </div>
        )}
        <p className="text-sm text-foreground-muted">
          {state === 'closed' ? t('app.feedback.frozen') : t('app.feedback.guardianAnswers')}
        </p>
      </>
    );
  } else {
    body = <p className="text-sm text-foreground-muted">{t(`app.feedback.state.${state}`)}</p>;
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-foreground-muted">
        <MessageSquareText className="size-4" aria-hidden />
        {named ? t('app.feedback.titleFor', { name: standing.studentName }) : t('app.feedback.title')}
      </h2>
      {body}
    </section>
  );
}

/**
 * *Últimas aulas* — the lessons the children attended inside the window, newest
 * first, each with its face or *Dar feedback*. Absent when there are none: an
 * empty strip under the coming lessons says nothing a family needs.
 */
export async function RecentLessons({
  recent,
  names,
}: {
  recent: RecentLesson[];
  /** Each child's name, when the agenda shows several. */
  names: Map<string, string> | null;
}): Promise<React.ReactElement | null> {
  if (recent.length === 0) return null;
  const t = await getTranslations();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{t('app.feedback.recentTitle')}</h2>
      <ul className="flex flex-col gap-2">
        {recent.map((lesson) => {
          const child = names?.get(lesson.studentId) ?? null;
          return (
            <li key={`${lesson.sessionId}-${lesson.studentId}`}>
              <Link
                href={`/app/familia/aulas/${lesson.sessionId}`}
                className="flex min-h-control items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {dayHeading(t, lesson.localDate)} · {lesson.localTime}
                  </span>
                  <span className="truncate text-sm text-foreground-muted">
                    {[lesson.className, child].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm">
                  {lesson.mood !== null ? (
                    <MoodFace mood={lesson.mood} />
                  ) : lesson.open && lesson.mayAnswer ? (
                    <span className="font-medium text-primary">{t('app.feedback.give')}</span>
                  ) : null}
                  <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
                </span>
                <LinkBusy />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
