import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';

/** A taught lesson and the student's mark on it; null is not marked yet. */
export interface StripLesson {
  sessionId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  status: 'present' | 'absent' | 'excused' | null;
}

/**
 * A student's last lessons in a turma, at a glance — the handoff's attendance
 * strip (Slice 5, Rui 01-11-2026): one 14 × 6 px block per lesson, oldest
 * first. **Filled** is present, **muted** is absent, **outlined** is excused,
 * **dashed** is not marked yet.
 *
 * Colour never carries it alone: the count beside it is visible text ("5 / 8
 * presenças"), and the whole strip has one spoken sentence with every count. A
 * block's date and mark are in its title as a clarification, never the only
 * place a fact appears. The primary teal is the register's own, so it never
 * reads as a sport, a role or a certificate.
 */
const BLOCK: Record<NonNullable<StripLesson['status']> | 'none', string> = {
  present: 'bg-primary',
  absent: 'bg-foreground/15',
  excused: 'border border-primary',
  none: 'border border-dashed border-foreground/40',
};

export function AttendanceStrip({
  lessons,
  className,
}: {
  lessons: readonly StripLesson[];
  className?: string | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const count = (status: StripLesson['status']): number => lessons.filter((l) => l.status === status).length;
  const present = count('present');

  if (lessons.length === 0) {
    return <span className={cn('text-sm text-foreground-muted', className)}>{t('attendanceStrip.none')}</span>;
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        role="img"
        aria-label={t('attendanceStrip.summary', {
          lessons: lessons.length,
          present,
          absent: count('absent'),
          excused: count('excused'),
          unmarked: count(null),
        })}
        className="inline-flex items-center gap-[3px]"
      >
        {lessons.map((lesson) => (
          <span
            key={lesson.sessionId}
            title={`${formatDate(lesson.date)} · ${t(`attendanceStrip.status.${lesson.status ?? 'none'}`)}`}
            className={cn('h-1.5 w-3.5 rounded-[1px]', BLOCK[lesson.status ?? 'none'])}
          />
        ))}
      </span>
      <span className="font-mono text-xs tabular-nums text-foreground-muted">
        {t('attendanceStrip.count', { present, lessons: lessons.length })}
      </span>
    </span>
  );
}
