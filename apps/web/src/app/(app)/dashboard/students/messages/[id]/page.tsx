import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Me, type MessageDetail } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { formatStamp } from '@/lib/date-format';
import { PageError, PageShell, ScrollX } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import { audienceKey, deliveryKey } from '../delivery-text';
import { ArchiveMessage } from './archive-message';

/**
 * One message, and everybody it was written to — POOLSE-67.
 *
 * The recipient list is the record: names and addresses *as they were* when it
 * was sent, so a guardian unlinked since is still shown as having been told. A
 * row with no address is a student nobody could reach, said in words; a row not
 * yet delivered says that too, rather than implying a family was contacted.
 *
 * Exempt from paging (CONVENTIONS): one message's recipients are bounded by the
 * audience it was sent to, and a partial list of who was told is not a record.
 */
export default async function MessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const { tab } = await searchParams;

  let message: MessageDetail | null = null;
  let organizationId = '';
  let failure: LoadFailure | null = null;

  try {
    const [loaded, me] = await Promise.all([
      apiFetch<MessageDetail>(`/messages/${id}`),
      apiFetch<Me>('/me'),
    ]);
    message = loaded;
    organizationId = me.memberships[0]?.organizationId ?? '';
  } catch (error) {
    // A refusal and an absence are the same answer here: an instructor asking
    // for another turma's message is told it is not there, as the API says.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403 || error.status === 400)) {
      notFound();
    }
    failure = describeLoad(error);
  }

  if (message === null) {
    return (
      <PageShell
        title={t('messages.title')}
        back={{ href: '/dashboard/students/messages', label: t('messages.backToList') }}
      >
        {failure !== null && (
          <PageError
            message={t(failure.key)}
            {...(failure.detail === '' ? {} : { detail: failure.detail })}
          />
        )}
      </PageShell>
    );
  }

  const loaded = message;
  const delivery = deliveryKey(loaded);

  return (
    <DetailPage
      title={loaded.subject}
      back={{ href: '/dashboard/students/messages', label: t('messages.backToList') }}
      actions={
        loaded.canArchive ? (
          <ArchiveMessage organizationId={organizationId} messageId={loaded.id} />
        ) : null
      }
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
          <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-foreground-muted">{t('messages.field.audience')}</dt>
              <dd>{t(audienceKey(loaded.audience) as never, { name: loaded.targetName ?? '' })}</dd>
              <dt className="text-foreground-muted">{t('messages.sentAt')}</dt>
              <dd>
                {formatStamp(loaded.sentAt)}
                {loaded.sentByName !== null &&
                  ` · ${t('messages.sentBy', { name: loaded.sentByName })}`}
              </dd>
              <dt className="text-foreground-muted">{t('messages.deliveryLabel')}</dt>
              <dd>{t(delivery.key as never, delivery.values)}</dd>
            </dl>
            <div className="whitespace-pre-wrap border-t border-border pt-3">{loaded.body}</div>
          </section>
          ),
        },
        {
          slug: 'recipients',
          labelKey: 'messages.recipients',
          content: () => (
          <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
            {loaded.unreachableCount > 0 && (
              <p className="text-sm">
                {t('messages.unreachableCount', { count: loaded.unreachableCount })}
              </p>
            )}
            <ScrollX>
              <table className="w-full text-left text-sm">
                <thead className="text-foreground-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-normal">{t('messages.column.student')}</th>
                    <th scope="col" className="py-2 pr-4 font-normal">{t('messages.column.writtenTo')}</th>
                    <th scope="col" className="py-2 pr-4 font-normal">{t('messages.column.address')}</th>
                    <th scope="col" className="py-2 font-normal">{t('messages.column.state')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loaded.recipients.map((recipient, index) => (
                    <tr key={`${recipient.studentName}-${recipient.email ?? 'none'}-${index}`}>
                      <td className="py-2 pr-4">{recipient.studentName}</td>
                      <td className="py-2 pr-4">
                        {recipient.isGuardian ? recipient.name : t('messages.theStudent')}
                      </td>
                      <td className="py-2 pr-4">
                        {recipient.email ?? (
                          <span className="text-foreground-muted">{t('messages.noAddress')}</span>
                        )}
                      </td>
                      <td className="py-2">
                        {recipient.email === null
                          ? t('messages.state.unreachable')
                          : recipient.deliveredAt === null
                            ? t('messages.state.notSent')
                            : t('messages.state.sent', { at: formatStamp(recipient.deliveredAt) })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          </section>
          ),
        },
      ]}
    />
  );
}
