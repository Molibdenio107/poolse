import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Me, type ReposicaoSettings } from '@/lib/api';
import { PageShell } from '@/components/page-shell';
import { ReposicaoSettingsForm } from './reposicoes-form';

/**
 * Aulas de reposição — the club's rules — POOLSE-21.
 *
 * Under Alunos rather than in a settings section of its own, because that is
 * what a reposição is about: a class a student missed and is owed. There is no
 * general settings area yet, and inventing one for a single feature would put
 * the rule two clicks further from the thing it governs.
 *
 * It began under Turmas and moved in round 5; the back link did not move with
 * it, so arriving from Alunos and pressing Voltar landed on Turmas — a screen
 * the reader had not come from and had no reason to be on. Back points at the
 * register now, which is both where the menu entry lives and where the only
 * other link here comes from (a student's medical leave). The URL stays
 * `/dashboard/classes/reposicoes`: renaming a route to match a menu is a
 * redirect and a round of broken bookmarks for no gain the reader can see.
 *
 * Owner and admin only, and the API refuses the read as well as the write — a
 * screen that shows settings it will not save is a screen that lies about what
 * it is for.
 */
export default async function ReposicoesPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let settings: ReposicaoSettings | null = null;
  let organizationId = '';
  let failure: string | null = null;
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
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <PageShell
      title={t('reposicao.title')}
      subtitle={t('reposicao.subtitle')}
      back={{ href: '/dashboard/students', label: t('students.backToRegister') }}
    >
      {/*
        A refusal in words rather than a blank page — the same rule as Staff.
        Somebody who followed a link is not doing anything wrong.
      */}
      {notPermitted && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <p className="font-medium">{t('reposicao.notPermitted')}</p>
          <p className="text-sm text-foreground-muted">{t('reposicao.notPermittedHint')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {settings !== null && (
        <section className="rounded border border-border bg-surface p-5">
          <ReposicaoSettingsForm organizationId={organizationId} settings={settings} />
        </section>
      )}
    </PageShell>
  );
}
