import { FromLink } from '@/components/from-link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Me, type Students } from '../../../../lib/api';
import { Pagination } from '@/components/pagination';
import { SearchInput, SearchStatus } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { backLabelKey, readFrom } from '@/lib/back';
import { AgedOutFlag } from '@/components/aged-out-flag';
import { PersonAvatar } from '@/components/person-avatar';
import { AttentionDot } from '@/components/attention-dot';
import { readAttention } from '@/lib/attention';
import { BirthdayFlag } from '@/components/birthday-flag';
import { photoUrlFor } from '@/lib/photo';
import { ArchiveStudentButton } from './student-forms';
import { StudentActions } from './import-panel';
import { PaymentMark } from './payment-mark';
import { PageError, PageShell } from '@/components/page-shell';
import { FamilyBulkInvite } from './family-bulk';
import { InviteStudent } from './invite-student';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMultiSport, isPoolseSport, type PoolseSport } from '@poolse/rules';
import { SportChip } from '@/components/sport-chip';
import { sportNameKey } from '@/components/sport-icon';
import { ScrollArrows } from '@/components/scroll-arrows';
import { ShortText } from '@/components/short-text';
import { shorten } from '@/lib/shorten';
import { timeAgo } from '@/lib/relative-time';
import { getLocale } from 'next-intl/server';

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
  searchParams: Promise<{
    search?: string;
    levelId?: string;
    page?: string;
    from?: string;
    sort?: string;
    invite?: string;
    sport?: string;
    multi?: string;
    modalidade?: string;
    overdue?: string;
    classGroupId?: string;
    insurance?: string;
    order?: string;
  }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const {
    search = '',
    levelId = '',
    page: pageParam,
    from,
    sort,
    invite,
    sport,
    multi,
    modalidade,
    overdue,
    classGroupId: requestedTurma = '',
    insurance: requestedInsurance,
    order: requestedOrder,
  } = await searchParams;
  // POOLSE-164's filters: one turma (or *Sem turma*), the seguro today, youngest first.
  const noTurma = requestedTurma === 'none' || sport === 'none';
  const classGroupId = noTurma ? '' : requestedTurma.trim();
  const insurance =
    requestedInsurance === 'insured' || requestedInsurance === 'lapsed' || requestedInsurance === 'never'
      ? requestedInsurance
      : '';
  const byAge = requestedOrder === 'age';

  /*
   * Only the students who owe money — round 5.
   *
   * A filter, not a sort. Sorting by payment put the overdue students first and
   * left everybody else underneath, so "who do I telephone" was answered by a
   * list that still contained the whole club — and page two of a sorted register
   * is not the rest of the answer. Filtering makes the count in the header mean
   * something.
   *
   * One recognised value, not a column name from the URL: a parameter that
   * reaches an ORDER BY or a WHERE is a parameter somebody can inject.
   */
  const overdueOnly = sort === 'overdue' || overdue === '1';
  // *Por convidar* — POOLSE-129: somebody on the record could use the app and
  // has neither a login nor a live invitation.
  const pendingOnly = invite === 'pending';
  /*
   * Two ways to name a sport, and they must not be one (Rui, 04-11-2026).
   * `?sport=` is a sport's own *Alunos*, reached from its tab — the menu reads
   * it and moves to that sport's section. `?modalidade=` is the shared
   * register's *Desporto* filter, which narrows the list and leaves the reader
   * where they are. Both reach the API as its `sport` filter.
   */
  const ownSport: PoolseSport | null = isPoolseSport(sport) ? sport : null;
  const pickedSport: PoolseSport | null = ownSport === null && isPoolseSport(modalidade) ? modalidade : null;
  // `none` is *Sem turma* — in no live turma, so in no sport (POOLSE-143, -164).
  const sportFilter: PoolseSport | 'none' | null = noTurma ? 'none' : (ownSport ?? pickedSport);
  const multiOnly = ownSport === null && (multi === '1' || sport === 'multi' || modalidade === 'multi');
  const flags = {
    overdue: overdueOnly ? '1' : undefined,
    invite: pendingOnly ? 'pending' : undefined,
    sport: ownSport ?? undefined,
    modalidade: pickedSport ?? (multiOnly ? 'multi' : undefined),
    classGroupId: noTurma ? 'none' : classGroupId || undefined,
    insurance: insurance || undefined,
    order: byAge ? 'age' : undefined,
  };
  // The club's own `/me`: its name for a shared link, and whether it has a
  // second sport — the only case the *Modalidades* chips and column appear in.
  const me = await apiFetch<Me>('/me').catch(() => null);
  const attention = await readAttention();
  // POOLSE-207: who came of age with a parent's link. The office's only; anybody else is refused, and sees nothing.
  const turned = await apiFetch<{ students: unknown[] }>('/students/turned-18').catch(() => null);
  const turnedCount = turned?.students.length ?? 0;
  const clubSports = me?.memberships[0]?.sports ?? [];
  const multiSport = isMultiSport(clubSports);

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
  if (overdueOnly) query.set('overdue', '1');
  if (pendingOnly) query.set('invite', 'pending');
  if (sportFilter !== null) query.set('sport', sportFilter);
  if (multiOnly) query.set('multi', '1');
  if (classGroupId !== '') query.set('classGroupId', classGroupId);
  if (insurance !== '') query.set('insurance', insurance);
  if (byAge) query.set('order', 'age');
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
  // The overdue filter travels too: an export under a filtered list must be the
  // list, or the button lies about what it is exporting.
  if (overdueOnly) exportQuery.set('sort', 'overdue');
  if (sportFilter !== null) exportQuery.set('sport', sportFilter);
  if (multiOnly) exportQuery.set('multi', '1');
  if (classGroupId !== '') exportQuery.set('classGroupId', classGroupId);
  if (insurance !== '') exportQuery.set('insurance', insurance);

  let data: Students | null = null;
  let failure: LoadFailure | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Students>(`/students${query.size > 0 ? `?${query}` : ''}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'no_organization') {
      noOrganization = true;
    } else {
      failure = describeLoad(error);
    }
  }

  // The club's name, for the message a shared link carries.
  const organizationName = data === null ? '' : (me?.memberships[0]?.organizationName ?? '');

  /*
   * A sport's own *Alunos* (POOLSE-143, Rui 01-11-2026): reached from the sport's
   * tab, the sport is the page, not a filter — *Limpar* keeps it, and the chips
   * are that sport and *Todos*, which goes back to the shared register.
   */
  const sportPage = ownSport !== null;
  const filtering =
    search.trim().length > 0 ||
    levelId.trim().length > 0 ||
    overdueOnly ||
    pendingOnly ||
    sportFilter === 'none' ||
    pickedSport !== null ||
    multiOnly ||
    classGroupId !== '' ||
    insurance !== '';
  const clearHref = ownSport !== null ? `/dashboard/students?sport=${ownSport}` : '/dashboard/students';

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
        // The filter and the way back travel too: settling the last debtor on
        // the last page must not land somebody on the whole register.
        { search, levelId, ...flags, from },
        lastPage(data.students.total, data.students.limit),
      ),
    );
  }

  return (
    <PageShell
      title={t('students.title')}
      back={origin === null ? undefined : { href: origin, label: t(backLabelKey(origin)) }}
      subtitle={t('students.subtitle')}
      /*
        Wide — POOLSE-164 (Rui, 04-11-2026: "we can make the page bigger"): the
        second caller after the calendar, taken out loud and recorded in
        decisions.md. A third is a decision about what these pages share, never
        a tidy-up.
      */
      width="wide"
      // *Convidar membros* on the right, out of the way (POOLSE-164 rule 3).
      actions={
        data?.canInviteFamilies === true ? (
          <FamilyBulkInvite search={search.trim()} levelId={levelId.trim()} />
        ) : undefined
      }
    >

      {noOrganization && (
        <section className="rounded bg-surface p-5 shadow-card">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {turnedCount > 0 && (
        <FromLink
          href="/dashboard/students/fez-18"
          className="flex items-center justify-between gap-3 rounded border border-primary bg-primary/[0.08] p-4 text-sm font-medium hover:bg-primary/[0.12]"
        >
          <span>{t('majority.banner', { count: turnedCount })}</span>
          <span className="text-primary">{t('majority.open')}</span>
        </FromLink>
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
          {/*
            Every filter in one place — POOLSE-164 (Rui, 04-11-2026): search,
            sport, level, turma (and *Sem turma*), seguro, overdue and *por
            convidar*, each in the URL. A select carries its word inside as the
            prompt ("Nível: todos"), never a label above it. On a phone the row
            scrolls sideways rather than wrapping into a wall of controls.
          */}
          <section aria-label={t('students.filters.title')} className="rounded bg-surface p-4 shadow-card">
            <ScrollArrows>
              <div data-scroll-row className="flex items-end gap-3 md:flex-wrap max-md:overflow-x-auto max-md:pb-1">
                <SearchInput label={t('students.search')} placeholder={t('students.searchPlaceholder')} />

                {/* A sport's own register is that sport: no other sport offered there. */}
                {multiSport && !sportPage && (
                  <FilterSelect
                    name="modalidade"
                    label={t('students.filters.sport')}
                    hideLabel
                    value={multiOnly ? 'multi' : (pickedSport ?? '')}
                    anyLabel={t('students.filters.sport')}
                    options={[
                      ...clubSports.map((one) => ({ value: one, label: t(sportNameKey(one)) })),
                      { value: 'multi', label: t('students.filters.multi') },
                    ]}
                  />
                )}

                <FilterSelect
                  name="levelId"
                  label={t('students.level')}
                  hideLabel
                  value={levelId}
                  anyLabel={t('students.level')}
                  options={data.levels.map((level) => ({ value: level.id, label: level.name }))}
                />

                <FilterSelect
                  name="classGroupId"
                  label={t('students.filters.turma')}
                  hideLabel
                  value={noTurma ? 'none' : classGroupId}
                  anyLabel={t('students.filters.turma')}
                  options={[
                    { value: 'none', label: t('students.filters.noTurma') },
                    ...data.turmas.map((turma) => ({ value: turma.id, label: turma.name })),
                  ]}
                />

                <FilterSelect
                  name="insurance"
                  label={t('students.filters.insurance')}
                  hideLabel
                  value={insurance}
                  anyLabel={t('students.filters.insurance')}
                  options={(['insured', 'lapsed', 'never'] as const).map((state) => ({
                    value: state,
                    label: t(`students.table.insurance.${state}`),
                  }))}
                />

                {/* Only who owes — round 5; a checkbox that is a link, so it lives in the URL. */}
                {data.canManage && (
                  <FromLink
                    href={pageHref('/dashboard/students', { search, levelId, ...flags, overdue: overdueOnly ? undefined : '1' }, 1)}
                    role="checkbox"
                    aria-checked={overdueOnly}
                    className={cn(
                      'flex min-h-control shrink-0 items-center gap-2 rounded-sm border px-4 py-1 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      overdueOnly ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-surface-muted',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        overdueOnly ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                    >
                      {overdueOnly && <Check className="size-3" />}
                    </span>
                    {t('fees.showOverdueOnly')}
                  </FromLink>
                )}

                {/* *Por convidar* — POOLSE-129, the same checkbox-as-a-link. */}
                <FromLink
                  href={pageHref('/dashboard/students', { search, levelId, ...flags, invite: pendingOnly ? undefined : 'pending' }, 1)}
                  role="checkbox"
                  aria-checked={pendingOnly}
                  className={cn(
                    'flex min-h-control shrink-0 items-center gap-2 rounded-sm border px-4 py-1 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    pendingOnly ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-surface-muted',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                      pendingOnly ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                    )}
                  >
                    {pendingOnly && <Check className="size-3" />}
                  </span>
                  {t('familyBulk.pendingOnly')}
                </FromLink>

                {filtering && (
                  <FromLink
                    href={clearHref}
                    className="inline-flex h-control shrink-0 items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('students.clear')}
                  </FromLink>
                )}
              </div>
            </ScrollArrows>
          </section>

          {/*
            The register's three file-and-record actions, and the importer that
            two of them open — slice 1.10 and 1.11.

            One client island rather than three server links, because opening the
            importer is client state: a spreadsheet dropped anywhere on this
            screen opens it too, and a drop cannot change the URL.
          */}
          {data.canManage && (
            <StudentActions
              levels={data.levels}
              exportHref={`/dashboard/students/export${exportQuery.size > 0 ? `?${exportQuery}` : ''}`}
              filtering={filtering}
            />
          )}

          {/* The exames médicos as a spreadsheet — POOLSE-133. */}
          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('students.readOnly')}</p>
          )}

          {/*
            Into the app — POOLSE-129 (Rui, 30-10-2026). *Convidar aluno* is
            somebody not yet on the register, created and invited in one go;
            *Convidar membros* is everybody on this list who never joined.
          */}
          {data.canInviteFamilies && data.canManage && <InviteStudent organizationName={organizationName} />}

          <section className="rounded bg-surface p-5 shadow-card">
            {/* How many records, filtered or not — the table's top-right corner (Rui, 04-11-2026). */}
            <p aria-live="polite" className="mb-4 text-right text-sm font-medium text-foreground-muted">
              {t('students.count', { count: data.students.total })}
            </p>

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
                    <FromLink
                      href={levelId.trim() === '' ? '/dashboard/students' : `/dashboard/students?levelId=${levelId.trim()}`}
                      className="inline-flex h-control items-center justify-center px-4 text-control gap-2 mt-2 rounded-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card"
                    >
                      {t('search.clearSearch')}
                    </FromLink>
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
              <div className="relative overflow-x-auto">
                <table className="table-stack w-full border-collapse text-sm">
                  <caption className="sr-only">{t('students.count', { count: data.students.total })}</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-foreground-muted">
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t('students.table.name')}
                      </th>
                      {/* Sortable: youngest first, and back to the name order (POOLSE-164). */}
                      <th scope="col" aria-sort={byAge ? 'ascending' : 'none'} className="px-2 py-2 font-medium">
                        <FromLink
                          href={pageHref('/dashboard/students', { search, levelId, ...flags, order: byAge ? undefined : 'age' }, 1)}
                          className="rounded underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {t('students.table.age')}
                          {byAge ? ' ↑' : ''}
                        </FromLink>
                      </th>
                      {multiSport && (
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t('students.table.sports')}
                        </th>
                      )}
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t('students.table.level')}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t('students.table.turmas')}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t('students.table.insurance.title')}
                      </th>
                      {data.canManage && (
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t('students.table.fees')}
                        </th>
                      )}
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t('students.table.access')}
                      </th>
                      {data.canManage && (
                        <th scope="col" className="w-10 px-2 py-2">
                          <span className="sr-only">{t('students.table.actions')}</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.items.map((student) => (
                      <tr key={student.id} className="border-b border-border/60 align-middle last:border-0">
                        <th scope="row" className="px-2 py-2 text-left font-normal">
                          <span className="flex min-w-0 items-center gap-3">
                            <PersonAvatar
                              id={student.id}
                              name={student.displayName}
                              // Null unless consent is live: the API gates the key.
                              photoUrl={photoUrlFor(student.photoFileId)}
                            />
                            <span className="flex min-w-0 flex-wrap items-center gap-2">
                              {/* "Maria Santos", never "Santos, Maria" — POOLSE-32; the full name on hover. */}
                              <FromLink
                                href={`/dashboard/students/${student.id}`}
                                className="truncate font-medium text-primary hover:underline coarse:-my-3 coarse:py-3"
                                title={student.displayName}
                              >
                                {shorten(student.shortName ?? '', 20)}
                              </FromLink>
                              {/* POOLSE-190: beside the name, and the order stays the list's own. */}
                              <AttentionDot
                                count={attention.students[student.id]}
                                label={t('attention.studentReview', { count: attention.students[student.id] ?? 0 })}
                              />
                              <BirthdayFlag birthDate={student.birthDate} />
                              {/* Both capacities, on one row — POOLSE-23 AC6. */}
                              {student.isAdultStudent && (
                                <span className="rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground-muted">
                                  {t('students.badgeAdult')}
                                </span>
                              )}
                              {student.isGuardian && (
                                <span className="rounded border border-primary/40 px-2 py-0.5 text-xs text-primary">
                                  {t('students.badgeGuardian')}
                                </span>
                              )}
                            </span>
                          </span>
                        </th>
                        <td data-label={t('students.table.age')} className="px-2 py-2 md:whitespace-nowrap tabular-nums">
                          {student.age === null ? '—' : t('students.years', { count: student.age })}
                        </td>
                        {multiSport && (
                          <td data-label={t('students.table.sports')} className="px-2 py-2">
                            <span className="flex flex-wrap gap-1 max-md:justify-end">
                              {(student.sports ?? []).length === 0
                                ? '—'
                                : (student.sports ?? []).map((one) => <SportChip key={one} sport={one} />)}
                            </span>
                          </td>
                        )}
                        <td data-label={t('students.table.level')} className="px-2 py-2 md:whitespace-nowrap">
                          <span className="flex flex-wrap items-center gap-2 max-md:justify-end">
                            {student.levelName === null ? (
                              <span className="text-foreground-muted">{t('students.noLevel')}</span>
                            ) : (
                              <ShortText text={student.levelName} max={16} />
                            )}
                            {/* A gentle flag, never a removal — backlog round 4, ticket 3. */}
                            <AgedOutFlag student={student} levels={data.levels} />
                          </span>
                        </td>
                        <td data-label={t('students.table.turmas')} className="px-2 py-2 md:whitespace-nowrap">
                          {(student.turmas ?? []).length === 0 ? (
                            <span className="text-foreground-muted">{t('students.filters.noTurma')}</span>
                          ) : (
                            <ShortText text={(student.turmas ?? []).map((turma) => turma.name).join(', ')} max={18} />
                          )}
                        </td>
                        <td data-label={t('students.table.insurance.title')} className="px-2 py-2 md:whitespace-nowrap">
                          {student.insuranceState === undefined ? (
                            '—'
                          ) : (
                            <span
                              className={
                                student.insuranceState === 'insured'
                                  ? 'text-foreground'
                                  : student.insuranceState === 'lapsed'
                                    ? 'text-warning'
                                    : 'text-foreground-muted'
                              }
                            >
                              {t(`students.table.insurance.${student.insuranceState}`)}
                            </span>
                          )}
                        </td>
                        {data.canManage && (
                          <td data-label={t('students.table.fees')} className="px-2 py-2 md:whitespace-nowrap">
                            {student.paymentState === 'overdue' ? (
                              <PaymentMark state={student.paymentState} />
                            ) : student.paymentState === 'none' ? (
                              <span className="text-foreground-muted">—</span>
                            ) : (
                              <span className="text-foreground-muted">{t('students.table.feesUpToDate')}</span>
                            )}
                          </td>
                        )}
                        <td data-label={t('students.table.access')} className="px-2 py-2 md:whitespace-nowrap text-foreground-muted">
                          {student.familyLastSeenAt != null
                            ? t('staff.table.seen', { ago: timeAgo(student.familyLastSeenAt, locale) ?? '' })
                            : student.familyHasLogin === true
                              ? t('staff.table.neverSeen')
                              : t('staff.table.noLogin')}
                        </td>
                        {data.canManage && (
                          <td className="px-2 py-2 text-right">
                            <ArchiveStudentButton
                              organizationId={data.organizationId}
                              studentId={student.id}
                              name={student.displayName}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Pagination
              page={data.students}
              basePath="/dashboard/students"
              // The overdue filter and the way back travel with the page, as
              // they do on the past-the-end redirect above.
              query={{ search, levelId, ...flags, from }}
            />
          </section>

        </>
      )}
    </PageShell>
  );
}
