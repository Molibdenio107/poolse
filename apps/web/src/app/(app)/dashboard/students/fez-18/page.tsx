import { getTranslations } from 'next-intl/server';
import { apiFetch, type TurnedOfAge } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { FromLink } from '@/components/from-link';
import { MajorityActions } from './majority-actions';

/**
 * *Fez 18 anos* — POOLSE-207 rule 4 (Rui, 09-11-2026).
 *
 * Every student who came of age in the last 60 days with a parent's link still
 * live, until somebody acts. The parent already lost access on the birthday
 * (POOLSE-206); this is where the office says whether that is right. Owner and
 * Admin: the API refuses everybody else, and so does the menu.
 */
export default async function TurnedOfAgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const params = await searchParams;
  const back = originBack(typeof params.from === 'string' ? params.from : undefined);
  const loaded = await outcome(apiFetch<{ students: TurnedOfAge[] }>('/students/turned-18'));

  const shell = (children: React.ReactNode): React.ReactElement => (
    <PageShell title={t('majority.title')} subtitle={t('majority.subtitle')} back={backProp(back, t)}>
      {children}
    </PageShell>
  );

  if (loaded.state === 'refused') {
    return shell(
      <section className="rounded bg-surface p-5 shadow-card">
        <p className="font-medium">{t('majority.notPermitted')}</p>
      </section>,
    );
  }
  if (loaded.state === 'failed') {
    return shell(<PageError message={t(loaded.failure.key)} detail={loaded.failure.detail} />);
  }
  const students = loaded.data.students;
  if (students.length === 0) return shell(<PageEmpty message={t('majority.empty')} hint={t('majority.emptyHint')} />);

  return shell(
    <ul className="flex flex-col gap-3">
      {students.map((student) => (
        <li key={student.studentId} className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
          <div className="flex flex-col gap-1">
            <FromLink href={`/dashboard/students/${student.studentId}`} className="font-medium text-primary hover:underline">
              {student.name}
            </FromLink>
            <p className="text-sm text-foreground-muted">
              {t('majority.cameOfAge', { date: formatDate(student.majorityOn) })}
            </p>
            {student.parents.length > 0 && (
              <p className="text-sm">
                {t('majority.parents', {
                  names: student.parents
                    .map((parent) => (parent.relationship === null ? parent.name : `${parent.name} (${parent.relationship})`))
                    .join(', '),
                })}
              </p>
            )}
            <p className="text-sm text-foreground-muted">{t('majority.whatChanged')}</p>
          </div>
          <MajorityActions studentId={student.studentId} name={student.name} invitable={student.invitable} />
        </li>
      ))}
    </ul>,
  );
}
