import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronRight } from 'lucide-react';
import { apiFetch, type TeachingStudent } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { photoUrlFor } from '@/lib/photo';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { PersonAvatar } from '@/components/person-avatar';
import { clubInvite } from '@/lib/club-invite';
import { JoinQr } from './join-qr';
import { StudentFilter } from './student-filter';

/**
 * The teacher's *Alunos* (Rui, 07-11-2026): everybody in a turma they teach, a
 * name and a face, and a tap for the card. A name filter, because a teacher with
 * six turmas has sixty children.
 */
export default async function TeachingStudents({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { q } = await searchParams;

  let students: TeachingStudent[];
  try {
    students = (await apiFetch<{ students: TeachingStudent[] }>('/app/teaching/students')).students;
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  // A small icon beside the title (Rui, 07-11-2026), while pre-registration is open.
  const invite = await clubInvite((club) => t('invite.clubMessage', { club }));
  const wanted = (q ?? '').trim().toLocaleLowerCase('pt-PT');
  const shown =
    wanted === '' ? students : students.filter((one) => one.shortName.toLocaleLowerCase('pt-PT').includes(wanted));

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1>{t('app.tabs.alunos')}</h1>
        {invite !== null && <JoinQr invite={invite} />}
      </div>
      {students.length === 0 ? (
        <p className="text-foreground-muted">{t('app.teaching.studentsNone')}</p>
      ) : (
        <>
          <StudentFilter initial={q ?? ''} />
          {shown.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('app.teaching.studentsNoMatch')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {shown.map((student) => (
                <li key={student.id}>
                  <Link
                    href={`/app/alunos/${student.id}`}
                    className="flex min-h-[52px] items-center gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <PersonAvatar
                      id={student.id}
                      name={student.shortName}
                      photoUrl={photoUrlFor(student.photoFileId)}
                      size="sm"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{student.shortName}</span>
                      <span className="truncate text-sm text-foreground-muted">{student.turmas.join(' · ')}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
                    <LinkBusy />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
