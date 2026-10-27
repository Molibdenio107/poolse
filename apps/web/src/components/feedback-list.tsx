import { getLocale, getTranslations } from 'next-intl/server';
import type { LessonFeedback } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { timeAgo } from '@/lib/relative-time';
import { MoodFace } from '@/components/mood';
import { ArchiveFeedbackButton } from '@/components/archive-feedback-button';

/**
 * Lesson feedback for staff — POOLSE-116: the register's strip (one lesson,
 * named by student) and a student's record (one student, named by lesson).
 * Who wrote it is derived on the server — the student, or a guardian by name —
 * and never sent by the client. The rows are already the ones this reader may
 * see; `canArchive` is the owner/admin answer the page already has.
 */
export async function FeedbackList({
  items,
  by,
  canArchive,
}: {
  items: LessonFeedback[];
  /** `student` on the register; `lesson` on a student's record. */
  by: 'student' | 'lesson';
  canArchive: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">
              {by === 'student'
                ? item.studentName
                : [formatDate(item.lessonDate), item.className].filter(Boolean).join(' · ')}
            </p>
            <MoodFace mood={item.mood} />
            {item.comment !== null && <p className="whitespace-pre-wrap break-words">{item.comment}</p>}
            <p className="text-sm text-foreground-muted">
              {[
                item.authoredBy === 'student'
                  ? t('feedback.byStudent')
                  : item.authoredBy === 'guardian' && item.authorName !== null
                    ? t('feedback.byGuardian', { name: item.authorName })
                    : t('feedback.byNobody'),
                t('feedback.ago', { ago: timeAgo(item.updatedAt, locale) ?? formatDate(item.updatedAt.slice(0, 10)) }),
              ].join(' · ')}
            </p>
          </div>
          {canArchive && <ArchiveFeedbackButton feedbackId={item.id} />}
        </li>
      ))}
    </ul>
  );
}
