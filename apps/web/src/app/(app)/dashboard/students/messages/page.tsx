import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type MessageList } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { formatStamp } from '@/lib/date-format';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { audienceKey, deliveryKey } from './delivery-text';

/**
 * Mensagens — POOLSE-67.
 *
 * Under Alunos, beside Encarregados, because the people written to are the
 * families the register holds. The history is the record a club did not have:
 * who sent what, to whom, when, and whether it left.
 *
 * Owner and admin see every message; an instructor sees those addressed to
 * their own turmas, the office's included. The API decides which, in the same
 * statement as the page window.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam } = await searchParams;
  const page = readPage(pageParam);

  let data: MessageList | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    data = await apiFetch<MessageList>(`/messages${page > 1 ? `?page=${page}` : ''}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  if (data !== null && isPastEnd(page, data.total, data.limit)) {
    redirect(pageHref('/dashboard/students/messages', {}, lastPage(data.total, data.limit)));
  }

  return (
    <PageShell
      title={t('messages.title')}
      subtitle={t('messages.subtitle')}
      back={{ href: '/dashboard/students', label: t('students.backToRegister') }}
      actions={
        data?.canSend ? (
          <Link
            href="/dashboard/students/messages/new"
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            {t('messages.new')}
          </Link>
        ) : null
      }
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

      {data !== null && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          {data.total === 0 ? (
            <div className="flex flex-col gap-1">
              <p>{t('messages.empty')}</p>
              <p className="text-sm text-foreground-muted">{t('messages.emptyHint')}</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.items.map((message) => {
                const delivery = deliveryKey(message);
                return (
                  <li key={message.id} className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <Link
                        href={`/dashboard/students/messages/${message.id}`}
                        className="font-medium underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {message.subject}
                      </Link>
                      <span className="text-sm text-foreground-muted">
                        {formatStamp(message.sentAt)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground-muted">
                      {t(audienceKey(message.audience) as never, { name: message.targetName ?? '' })}
                      {message.sentByName !== null &&
                        ` · ${t('messages.sentBy', { name: message.sentByName })}`}
                    </p>
                    <p className="text-sm">
                      {t(delivery.key as never, delivery.values)}
                      {message.unreachableCount > 0 &&
                        ` · ${t('messages.unreachableCount', { count: message.unreachableCount })}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <Pagination page={data} basePath="/dashboard/students/messages" />
        </section>
      )}
    </PageShell>
  );
}
