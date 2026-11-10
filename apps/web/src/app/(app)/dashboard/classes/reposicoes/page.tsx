import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { ApiError, apiFetch, type Classes, type Facilities, type Me, type ReposicaoSettings } from '@/lib/api';
import { PageError, PageShell } from '@/components/page-shell';
import { ReposicaoSettingsForm } from './reposicoes-form';
import { NothingYet } from '@/components/nothing-yet';

/**
 * Aulas de reposição — the club's rules — POOLSE-21.
 *
 * Under Alunos rather than in a settings section of its own, because that is
 * what a reposição is about: a class a student missed and is owed. There is no
 * general settings area yet, and inventing one for a single feature would put
 * the rule two clicks further from the thing it governs.
 *
 * It began under Turmas, moved to Alunos in round 5 and came back to Turmas in
 * POOLSE-103. Voltar follows where the reader came from (`originBack`), so a
 * menu move never strands it again; opened from the menu it has none. The URL stays
 * `/dashboard/classes/reposicoes`: renaming a route to match a menu is a
 * redirect and a round of broken bookmarks for no gain the reader can see.
 *
 * Owner and admin only, and the API refuses the read as well as the write — a
 * screen that shows settings it will not save is a screen that lies about what
 * it is for.
 */
export default async function ReposicoesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const back = originBack((await searchParams).from);

  let settings: ReposicaoSettings | null = null;
  let organizationId = '';
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    const [loaded, me] = await Promise.all([
      apiFetch<ReposicaoSettings>('/settings/reposicao'),
      apiFetch<Me>('/me'),
    ]);
    settings = loaded;
    organizationId = me.memberships[0]?.organizationId ?? '';
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  /*
    Nothing to set rules for yet (Rui, 10-11-2026): with no pool or no turma
    the form governs nothing, so the page says what comes first, as the
    calendar does. Best-effort: if either read fails the form shows as before.
  */
  let nothingYet: 'pools' | 'classes' | null = null;
  if (settings !== null) {
    const [sites, classes] = await Promise.all([
      apiFetch<Facilities>('/facilities').catch(() => null),
      apiFetch<Classes>('/class-groups').catch(() => null),
    ]);
    if (sites !== null && sites.facilities.every((site) => site.pools.length === 0)) nothingYet = 'pools';
    else if (classes !== null && classes.groups.length === 0) nothingYet = 'classes';
  }

  return (
    <PageShell
      title={t('reposicao.title')}
      subtitle={t('reposicao.subtitle')}
      back={backProp(back, t)}
    >
      {/*
        A refusal in words rather than a blank page — the same rule as Staff.
        Somebody who followed a link is not doing anything wrong.
      */}
      {notPermitted && (
        <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
          <p className="font-medium">{t('reposicao.notPermitted')}</p>
          <p className="text-sm text-foreground-muted">{t('reposicao.notPermittedHint')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {nothingYet !== null && (
        <NothingYet
          title={t(nothingYet === 'pools' ? 'calendar.nothingYet.noPoolsTitle' : 'calendar.nothingYet.noClassesTitle')}
          body={t(nothingYet === 'pools' ? 'reposicao.nothingYet.noPoolsBody' : 'reposicao.nothingYet.noClassesBody')}
          href={nothingYet === 'pools' ? '/dashboard/facilities' : '/dashboard/classes'}
          linkLabel={t(nothingYet === 'pools' ? 'calendar.nothingYet.noPoolsLink' : 'calendar.nothingYet.noClassesLink')}
        />
      )}

      {settings !== null && nothingYet === null && (
        <section className="rounded bg-surface p-5 shadow-card">
          <ReposicaoSettingsForm organizationId={organizationId} settings={settings} />
        </section>
      )}
    </PageShell>
  );
}
