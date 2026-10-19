import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { MessagePreference } from './message-preference';

/**
 * The profile's message preference, loaded on its own — POOLSE-86. A refusal
 * (support, which has no address here) or an account with no address shows
 * nothing; a failure says so rather than hiding the choice.
 */
export async function MessagePreferenceCard({ clubName }: { clubName: string }): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const loaded = await outcome(apiFetch<{ email: string | null; optedOut: boolean }>('/my/email-preference'));
  if (loaded.state === 'refused') return null;
  if (loaded.state === 'ok' && loaded.data.email === null) return null;

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('profile.messages.title')}
      </h2>
      {loaded.state === 'failed' ? (
        <p className="text-sm text-danger">{t(loaded.failure.key)}</p>
      ) : (
        <MessagePreference email={loaded.data.email!} optedOut={loaded.data.optedOut} clubName={clubName} />
      )}
    </section>
  );
}
