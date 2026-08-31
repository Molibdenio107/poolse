import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Students } from '../../../../lib/api';
import { Pagination } from '@/components/pagination';
import { SearchInput, SearchStatus } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { backLabelKey, readFrom } from '@/lib/back';
import { AgedOutFlag } from '@/components/aged-out-flag';
import { PersonAvatar } from '@/components/person-avatar';
import { BirthdayFlag } from '@/components/birthday-flag';
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
  searchParams: Promise<{ search?: string; levelId?: string; page?: string; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { search = '', levelId = '', page: pageParam, from } = await searchParams;

  /*
   * The register is a top-level section, so it has no parent and no back link —
   * except when somebody arrived from a screen that links into it, which a
   * facility's student count does. Then, and only then, there is somewhere to go
   * back to and the control appears — R4. Validated in `lib/back.ts`.
   */
  const origin = readFrom(from);
  const page = readPage(pageParam);

  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  if (levelId.trim()) query.set('levelId', levelId.trim());
  if (page > 1) query.set('page', String(page));

  /*
   * The same two filters, without the page — slice 1.11.
   *
   * An export is the whole filtered set, not the fifteen rows being looked at.
   * Handing `?page=3` to the exporter would produce a file whose contents depend
   * on where somebody happened to be scrolled, which is the sort of thing nobody
   * notices until a club emails the wrong list to a coach.
   */
  const exportQuery = new URLSearchParams();
  if (search.trim()) exportQuery.set('search', search.trim());
  if (levelId.trim()) exportQuery.set('levelId', levelId.trim());

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

  /*
   * A page that has fallen off the end — QA 29.6 and 29.12.
   *
   * Two ordinary things cause it: somebody follows a link to `?page=999`, and
   * somebody archives the last row on the last page. Both would otherwise render
   * an empty list under a control claiming page 15 of 14, which reads as the
   * records having been lost. A redirect rather than a clamp, so the URL ends up
   * telling the truth about which page is on screen.
   */
  if (data !== null && isPastEnd(page, data.students.total, data.students.limit)) {
    redirect(
      pageHref(
        '/dashboard/students',
        { search, levelId },
        lastPage(data.students.total, data.students.limit),
      ),
    );
  }

  return (
    <PageShell
      title={t('students.title')}
      back={origin === null ? undefined : { href: origin, label: t(backLabelKey(origin)) }}
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
          {/*
            No submit button — POOLSE-30 AC2. Both controls commit themselves
            into the URL: the search box after a ~300 ms debounce or at once on
            Enter, the level filter the moment it changes.

            The clear link stays. The × inside the box empties only the term, and
            somebody who has narrowed by level *and* by name wants one control
            that undoes both.
          */}
          <section className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-5">
            <SearchInput
              label={t('students.search')}
              placeholder={t('students.searchPlaceholder')}
            />

            <FilterSelect
              name="levelId"
              label={t('students.level')}
              value={levelId}
              anyLabel={t('students.allLevels')}
              options={data.levels.map((level) => ({ value: level.id, label: level.name }))}
            />

            {filtering && (
              <Link
                href="/dashboard/students"
                className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('students.clear')}
              </Link>
            )}
          </section>

          {/*
            Adding one and importing many, side by side — slice 1.10.
            The import lives here rather than in a menu because the moment
            somebody needs it is the moment they first see an empty register,
            and a migration path nobody finds is a migration path nobody uses.
          */}
          {data.canManage && (
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard/students/new"
                className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
              >
                {t('students.add')}
              </Link>
              <Link
                href="/dashboard/students/import"
                className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('students.import.action')}
              </Link>
              {/*
                A plain anchor, not `Link` — slice 1.11. The answer is a file, so
                there is no client navigation to make: `Link` would prefetch a
                spreadsheet and then hand the router an attachment it cannot
                render. It carries the current search and level, because an
                export button under a filtered register that quietly returns all
                four hundred students is a button that lies about what it did.
              */}
              <a
                href={`/dashboard/students/export${exportQuery.size > 0 ? `?${exportQuery}` : ''}`}
                className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {filtering ? t('students.export.actionFiltered') : t('students.export.action')}
              </a>
            </div>
          )}

          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('students.readOnly')}</p>
          )}

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('students.count', { count: data.students.total })}
            </h2>

            <SearchStatus total={data.students.total} term={search.trim()} />

            {/*
              The term, verbatim, and a way out of it — AC8. Distinct from "no
              students yet": one means the club has nobody, the other means this
              search found nobody, and offering "adicione o primeiro aluno" to
              somebody who mistyped a surname is the wrong advice.
            */}
            {data.students.total === 0 ? (
              <div className="flex flex-col items-start gap-1">
                {search.trim() !== '' ? (
                  <>
                    <p>{t('search.noResults', { term: search.trim() })}</p>
                    <p className="text-sm text-foreground-muted">{t('search.noResultsHint')}</p>
                    <Link
                      href={levelId.trim() === '' ? '/dashboard/students' : `/dashboard/students?levelId=${levelId.trim()}`}
                      className="mt-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {t('search.clearSearch')}
                    </Link>
                  </>
                ) : (
                  <>
                    <p>{filtering ? t('students.noneMatching') : t('students.none')}</p>
                    <p className="text-sm text-foreground-muted">
                      {filtering
                        ? t('students.noneMatchingHint')
                        : data.canManage
                          ? t('students.noneHintManager')
                          : t('students.noneHintMember')}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.students.items.map((student) => (
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
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/students/${student.id}`}
                          className="truncate text-primary hover:underline"
                          title={student.displayName}
                        >
                          {student.shortName}
                        </Link>
                        {/* Beside the name, on the day — round 4. */}
                        <BirthdayFlag birthDate={student.birthDate} />
                      </span>
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

            <Pagination
              page={data.students}
              basePath="/dashboard/students"
              query={{ search, levelId }}
            />
          </section>

        </>
      )}
    </PageShell>
  );
}
