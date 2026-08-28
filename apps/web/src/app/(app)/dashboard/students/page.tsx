import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Students } from '../../../../lib/api';
import { AgedOutFlag } from '@/components/aged-out-flag';
import { PersonAvatar } from '@/components/person-avatar';
import { photoUrlFor } from '@/lib/photo';
import { ArchiveStudentButton } from './student-forms';
import { PageShell } from '@/components/page-shell';

/**
 * Slice 1.2 — the student register.
 *
 * The roadmap sets the bar at "50 students manageable without pain", which is a
 * statement about this screen. Search and the level filter are a plain GET form
 * rather than anything reactive: the result is a real URL an operator can
 * bookmark or send to a colleague, it survives a refresh, and it works before
 * any JavaScript has loaded.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; levelId?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { search = '', levelId = '' } = await searchParams;

  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  if (levelId.trim()) query.set('levelId', levelId.trim());

  let data: Students | null = null;
  let failure: string | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Students>(`/students${query.size > 0 ? `?${query}` : ''}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      noOrganization = true;
    } else {
      failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
    }
  }

  const filtering = search.trim().length > 0 || levelId.trim().length > 0;

  return (
    <PageShell
      title={t('students.title')}
      subtitle={t('students.subtitle')}
    >

      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && (
        <>
          <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-48 flex-1 flex-col gap-2">
                <label htmlFor="student-search" className="text-sm text-foreground-muted">
                  {t('students.search')}
                </label>
                <input
                  id="student-search"
                  name="search"
                  defaultValue={search}
                  placeholder={t('students.searchPlaceholder')}
                  className="rounded border border-border bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="student-filter" className="text-sm text-foreground-muted">
                  {t('students.level')}
                </label>
                <select
                  id="student-filter"
                  name="levelId"
                  defaultValue={levelId}
                  className="rounded border border-border bg-background px-3 py-2"
                >
                  <option value="">{t('students.allLevels')}</option>
                  {data.levels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name}
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" className="rounded bg-primary px-4 py-2 text-primary-foreground">
                {t('students.search')}
              </button>
              {filtering && (
                <Link
                  href="/dashboard/students"
                  className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted"
                >
                  {t('students.clear')}
                </Link>
              )}
            </form>
          </section>

          {data.canManage && (
            <Link
              href="/dashboard/students/new"
              className="self-start rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              {t('students.add')}
            </Link>
          )}

          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('students.readOnly')}</p>
          )}

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('students.count', { count: data.students.length })}
            </h2>

            {data.students.length === 0 ? (
              <div className="flex flex-col gap-1">
                <p>{filtering ? t('students.noneMatching') : t('students.none')}</p>
                <p className="text-sm text-foreground-muted">
                  {filtering
                    ? t('students.noneMatchingHint')
                    : data.canManage
                      ? t('students.noneHintManager')
                      : t('students.noneHintMember')}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.students.map((student) => (
                  <li
                    key={student.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <PersonAvatar
                        id={student.id}
                        name={student.displayName}
                        // Already null unless consent is live: the API gates the
                        // key, this only turns a key into a URL.
                        photoUrl={photoUrlFor(student.photoStorageKey)}
                      />
                      <div className="flex min-w-0 flex-col">
                      {/*
                        "Maria Santos", never "Santos, Maria" — POOLSE-32.
                        Composed by the server, so this row and the turma roster
                        two clicks away cannot abbreviate differently.

                        `title` carries the full legal name for the long
                        compound that truncates here. It supplements the visible
                        text rather than replacing it: every part is on the
                        detail page this links to.
                      */}
                      <Link
                        href={`/dashboard/students/${student.id}`}
                        className="truncate text-primary hover:underline"
                        title={student.displayName}
                      >
                        {student.shortName}
                      </Link>
                      <span className="truncate text-sm text-foreground-muted">
                        {[
                          student.age === null ? null : t('students.years', { count: student.age }),
                          student.contactEmail,
                          student.contactPhone,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {student.levelName === null ? (
                        <span className="rounded bg-surface-muted px-2 py-0.5 text-sm text-foreground-muted">
                          {t('students.noLevel')}
                        </span>
                      ) : (
                        <span className="rounded bg-primary/15 px-2 py-0.5 text-sm text-primary">
                          {student.levelName}
                        </span>
                      )}
                      {/*
                        A gentle flag, never a removal — backlog round 4,
                        ticket 3. A child correctly enrolled in "3–5 anos" turns
                        six mid-season, and when they move up is the club's
                        decision, not the calendar's.
                      */}
                      <AgedOutFlag student={student} levels={data.levels} />
                      {data.canManage && (
                        <ArchiveStudentButton
                          organizationId={data.organizationId}
                          studentId={student.id}
                          name={student.displayName}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

        </>
      )}
    </PageShell>
  );
}
