import { getTranslations } from 'next-intl/server';
import { FromLink } from '@/components/from-link';
import type { EnrollmentClashStudent } from '@/lib/api';

/**
 * Students in two turmas at the same hour — POOLSE-144 BA 5.
 *
 * What the trigger now refuses, but that was already in the club's data or has
 * been made since by moving a turma. Nothing here is changed for the club: each
 * row links to the student and to each turma involved, where the fix is made by
 * hand. Owner and admin only; the API refuses anybody else.
 */
export async function ClashList({ students }: { students: EnrollmentClashStudent[] }): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-foreground-muted">{t('classes.clashes.hint')}</p>
      {students.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('classes.clashes.none')}</p>
      ) : (
        <div className="rounded border border-border bg-surface">
          <table className="table-stack w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="px-4 py-3 font-medium">{t('classes.clashes.student')}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t('classes.clashes.slots')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.studentId} className="border-b border-border/60 last:border-0">
                  <th scope="row" data-label={t('classes.clashes.student')} className="px-4 py-3 text-left font-normal">
                    <FromLink
                      href={`/dashboard/students/${student.studentId}?tab=turmas`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {student.name}
                    </FromLink>
                  </th>
                  <td data-label={t('classes.clashes.slots')} className="px-4 py-3">
                    {/* Right-aligned when the row stacks on a phone, like every value beside its label. */}
                    <ul className="flex flex-col gap-1 max-md:ml-auto max-md:items-end max-md:text-right">
                      {student.slots.map((slot) => (
                        <li key={`${slot.classGroupId}-${slot.weekday}-${slot.startTime}`}>
                          <FromLink
                            href={`/dashboard/classes/${slot.classGroupId}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {slot.turma}
                          </FromLink>
                          <span className="text-foreground-muted">
                            {' · '}
                            {t(`weekShort.${slot.weekday}`)} {slot.startTime}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
