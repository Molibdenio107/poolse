import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Me } from '@/lib/api';
import { ProfileForm } from './profile-form';
import { BackLink } from '@/components/back-link';

/**
 * "O meu perfil" — backlog round 3, story 1.
 *
 * Everybody gets this screen, and it is the only one in the backoffice where
 * that is true: an instructor cannot see People, cannot manage turmas and cannot
 * reach the register, but their own name is theirs. There is no role check here
 * on purpose, and the API has none either — `PUT /me/profile` writes to the
 * caller's own identity and cannot be pointed at anybody else's, which is a
 * stronger guarantee than a role would be.
 */
export default async function ProfilePage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let me: Me | null = null;
  let failure: string | null = null;

  try {
    me = await apiFetch<Me>('/me');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <BackLink href="/dashboard" label={t('common.backToDashboard')} />

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t('profile.title')}</h1>
        <p className="text-foreground-muted">{t('profile.subtitle')}</p>
      </header>

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {me !== null && (
        <section className="rounded border border-border bg-surface p-5">
          <ProfileForm me={me} />
        </section>
      )}
    </main>
  );
}
