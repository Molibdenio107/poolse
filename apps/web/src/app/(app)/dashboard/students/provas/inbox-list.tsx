import { FromLink } from '@/components/from-link';
import { getTranslations } from 'next-intl/server';
import { formatDate, formatStamp } from '@/lib/date-format';
import type { MeetInboxList } from '@/lib/api';
import { Pagination } from '@/components/pagination';
import { DiscardInboxButton } from './discard-inbox';
import { ImportFromInbox } from './import-meet';

/**
 * *Recebidos por email* — POOLSE-114 BA 4 and 5.
 *
 * Newest first, fifteen a page. Each row says what the file is (the meet and
 * its date, read at receipt), who sent it and when, and where it stands: a
 * pending file is imported through the ordinary dialog or rejected by the
 * office; an imported one is marked and links to its meet rather than leaving
 * the list. A file pending past ninety days carries a quiet *antigo* — nothing
 * here is deleted on its own.
 */
export async function InboxList({
  inbox,
  organizationId,
  rememberedClubCode,
  basePath,
}: {
  inbox: MeetInboxList;
  organizationId: string;
  rememberedClubCode: string | null;
  basePath: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <p className="text-sm text-foreground-muted">{t('meetInbox.intro')}</p>
      {inbox.total === 0 ? (
        <p>{t('meetInbox.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {inbox.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{item.meetName}</span>
                  <span className="text-sm text-foreground-muted">{formatDate(item.meetStartsOn)}</span>
                  {item.stale && (
                    <span className="rounded border border-border px-2 text-xs text-foreground-muted">
                      {t('meetInbox.stale')}
                    </span>
                  )}
                </p>
                <p className="break-words text-sm text-foreground-muted">
                  {t('meetInbox.from', {
                    file: item.fileName,
                    sender: item.senderName,
                    when: formatStamp(item.receivedAt),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {item.status === 'imported' ? (
                  <>
                    <span className="rounded border border-success/50 px-2 text-sm text-success">
                      {t('meetInbox.imported')}
                    </span>
                    {item.meetId !== null && (
                      <FromLink
                        href={`${basePath}/${item.meetId}`}
                        className="rounded text-sm text-primary underline underline-offset-4 coarse:-my-3 coarse:py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {t('meetInbox.openMeet')}
                      </FromLink>
                    )}
                  </>
                ) : (
                  <>
                    <ImportFromInbox
                      organizationId={organizationId}
                      rememberedClubCode={rememberedClubCode}
                      inboxId={item.id}
                      fileName={item.fileName}
                      label={t('meetInbox.importNamed', { meet: item.meetName })}
                    />
                    {inbox.canManage && (
                      <DiscardInboxButton
                        organizationId={organizationId}
                        inboxId={item.id}
                        label={t('meetInbox.discardNamed', { meet: item.meetName })}
                      />
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={inbox} basePath={`${basePath}/recebidos`} />
    </section>
  );
}
