import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type AudienceOptions, type Me } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { PageError, PageShell } from '@/components/page-shell';
import { MessageComposer } from '../composer';

/**
 * Nova mensagem — POOLSE-67.
 *
 * Takes `audience`, `targetId` and `subject` from the query string so another
 * screen can open it already pointed somewhere: the calendar's Cancelar aula
 * offers *Avisar as famílias* with the turma chosen and the date in the subject.
 * The composer checks the target against the reader's own options, so a link
 * naming a turma that is not theirs just starts on the first one that is — the
 * API would refuse it anyway.
 */
export default async function NewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string; targetId?: string; subject?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const query = await searchParams;

  let options: AudienceOptions | null = null;
  let me: Me | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    [options, me] = await Promise.all([
      apiFetch<AudienceOptions>('/messages/audiences'),
      apiFetch<Me>('/me'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  const membership = me?.memberships[0];
  const canAddressClub =
    membership?.roles.some((role) => role === 'owner' || role === 'admin') ?? false;

  return (
    <PageShell
      title={t('messages.new')}
      subtitle={t('messages.compose.subtitle')}
      back={{ href: '/dashboard/students/messages', label: t('messages.backToList') }}
    >
      {notPermitted && (
        <section className="flex flex-col gap-1 rounded border border-border bg-surface p-5">
          <p className="font-medium">{t('messages.notPermitted')}</p>
          <p className="text-sm text-foreground-muted">{t('messages.notPermittedHint')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {options !== null && membership !== undefined && (
        <MessageComposer
          organizationId={membership.organizationId}
          options={options}
          canAddressClub={canAddressClub}
          initial={{
            ...(query.audience === undefined ? {} : { audience: query.audience }),
            ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
            ...(query.subject === undefined ? {} : { subject: query.subject.slice(0, 200) }),
          }}
        />
      )}
    </PageShell>
  );
}
